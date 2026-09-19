const { invoke } = window.__TAURI__.core;

const form = document.getElementById("form");
const input = document.getElementById("url");
const save = document.getElementById("save");
const error = document.getElementById("error");
const version = document.getElementById("version");

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

async function load() {
  try {
    const info = await invoke("desktop_info");
    input.value = info.instanceUrl ?? "";
    version.textContent = `TeamOS ${info.version}`;
  } catch (err) {
    showError(String(err));
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  save.disabled = true;

  try {
    // The window closes itself on success, so there is nothing to do after.
    await invoke("desktop_set_instance_url", { url: input.value });
  } catch (err) {
    showError(String(err));
    save.disabled = false;
  }
});

input.addEventListener("input", () => showError(""));

void load();
