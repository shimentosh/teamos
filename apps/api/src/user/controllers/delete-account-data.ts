import { APIError } from "better-auth/api";
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import {
  findBillableWorkspaces,
  formatBillableWorkspacesMessage,
} from "../../billing/controllers/find-billable-workspaces";
import { syncWorkspaceSeats } from "../../billing/controllers/sync-seats";
import db from "../../database";
import {
  storedFileTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  formatBlockedWorkspacesMessage,
  hasOwnerRole,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "../account-deletion";

async function collectMemberships(
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  const memberships = await db
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));

  if (memberships.length === 0) {
    return [];
  }

  const workspaceIds = memberships.map((membership) => membership.workspaceId);

  const members = await db
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      workspaceName: workspaceTable.name,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(inArray(workspaceUserTable.workspaceId, workspaceIds));

  return memberships.map((membership) => {
    const workspaceMembers = members.filter(
      (member) => member.workspaceId === membership.workspaceId,
    );

    return {
      workspaceId: membership.workspaceId,
      workspaceName: workspaceMembers[0]?.workspaceName ?? "workspace",
      isOwner: hasOwnerRole(membership.role),
      memberCount: workspaceMembers.length,
      ownerCount: workspaceMembers.filter((member) => hasOwnerRole(member.role))
        .length,
    };
  });
}

export async function deleteAccountData(userId: string) {
  const plan = planAccountDeletion(await collectMemberships(userId));

  if (plan.blockedWorkspaceNames.length > 0) {
    throw new APIError("CONFLICT", {
      message: formatBlockedWorkspacesMessage(plan.blockedWorkspaceNames),
    });
  }

  // Files other people's workspaces keep in this person's bucket would be
  // unreachable once their account (and its bucket settings) is gone.
  const [inBucket] = await db
    .select({ n: count() })
    .from(storedFileTable)
    .where(
      and(
        eq(storedFileTable.storageOwnerId, userId),
        eq(storedFileTable.storage, "s3"),
        plan.workspaceIdsToDelete.length > 0
          ? notInArray(storedFileTable.workspaceId, plan.workspaceIdsToDelete)
          : undefined,
      ),
    );
  if ((inBucket?.n ?? 0) > 0) {
    throw new APIError("CONFLICT", {
      message: `${inBucket?.n} files in other workspaces are stored in your file storage bucket. Move or delete them, or hand the workspaces to someone who connects their own storage, before deleting your account.`,
    });
  }

  const billable = await findBillableWorkspaces(plan.workspaceIdsToDelete);
  if (billable.length > 0) {
    throw new APIError("CONFLICT", {
      message: formatBillableWorkspacesMessage(
        billable.map((workspace) => workspace.name),
      ),
    });
  }

  if (plan.workspaceIdsToDelete.length > 0) {
    await db
      .delete(workspaceTable)
      .where(inArray(workspaceTable.id, plan.workspaceIdsToDelete));
  }

  if (plan.workspaceIdsToLeave.length > 0) {
    await db
      .delete(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.userId, userId),
          inArray(workspaceUserTable.workspaceId, plan.workspaceIdsToLeave),
        ),
      );

    for (const workspaceId of plan.workspaceIdsToLeave) {
      await syncWorkspaceSeats(workspaceId).catch((error) => {
        console.error(
          "Seat sync after account deletion failed:",
          workspaceId,
          error,
        );
      });
    }
  }

  return plan;
}

export default deleteAccountData;
