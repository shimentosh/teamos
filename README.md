<h1 align="center">Company OS</h1>

<p align="center">
  Projects, people and work time in one self-hosted place.
</p>

<div align="center">

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Company OS runs a team's day-to-day work in one app: the projects and tasks
you plan, the people who do them, and the time they spend. It is built on
[Kaneo](https://github.com/usekaneo/kaneo), the open source project
management platform, and keeps its simple, fast core.

## What's inside

- **Projects and tasks**: boards, lists and backlog, checklists with
  drag-and-drop, comments with reactions, replies and link previews, files and
  links on tasks, labels, relations and custom fields.
- **Chat**: channels and direct messages, realtime over server-sent events,
  replies, reactions, read receipts, typing indicators and a floating chat
  window on every page.
- **People and attendance**: team directory, departments, clock in/out,
  leave requests, and automatic clock in/out from the desktop app.
- **Time and pay**: task timers, timesheets, payroll with overtime, expenses.
- **Desktop agent**: a small Tauri app that reports active/idle time and the
  app in use (never keystrokes, screenshots or window titles).
- **Reports, audit log, email notifications** (Resend or SMTP), files with
  Postgres or Cloudflare R2 storage, an MCP server for AI tools, and
  integrations with GitHub, Gitea, Slack, Discord, Mattermost, Telegram and
  webhooks.

## Getting started

Requirements: Node.js 20.19+, pnpm 10.32.1 and PostgreSQL 16.

```bash
git clone https://github.com/shimentosh/companyos.git
cd companyos
pnpm install

# Copy .env.sample to .env and set at least DATABASE_URL and AUTH_SECRET.
# See ENVIRONMENT_SETUP.md for every option.
cp .env.sample .env

pnpm dev
```

The web app runs on http://localhost:5173 and the API on
http://localhost:1337. Database migrations run when the API starts.

To self-host, build the bundled image from this repository with
`Dockerfile.kaneo` (the images published as `ghcr.io/usekaneo/*` are upstream
Kaneo and don't include the Company OS additions). A Helm chart is in
[`charts/kaneo`](./charts/kaneo/README.md).

Environment variables and internal package names keep their `KANEO_*` and
`@kaneo/*` prefixes, so configuration written for Kaneo keeps working.

## Development

- [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) for local configuration.
- [AGENTS.md](AGENTS.md) for the architecture and conventions.
- [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## Credits

Company OS is a fork of **[Kaneo](https://github.com/usekaneo/kaneo)**,
created by [Andrej Acevski](https://github.com/andrejsshell) and
[its contributors](https://github.com/usekaneo/kaneo/graphs/contributors),
and released under the MIT License. The project and task management core,
the API, the integrations and much of the interface are their work. Thank
you. If Kaneo is useful to you, consider
[sponsoring its development](https://github.com/sponsors/andrejsshell).

See [NOTICE](NOTICE) for details.

## License

MIT. See [LICENSE](LICENSE). The original Kaneo copyright notice is kept as
the license requires.
