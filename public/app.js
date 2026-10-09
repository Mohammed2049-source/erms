const rowsElement = document.querySelector("#employee-rows");
const loadingElement = document.querySelector("#loading-state");
const emptyElement = document.querySelector("#empty-state");
const dialog = document.querySelector("#employee-dialog");
const form = document.querySelector("#employee-form");
const formError = document.querySelector("#form-error");
const saveButton = document.querySelector("#save-employee-button");
const searchInput = document.querySelector("#search-input");
const departmentFilter = document.querySelector("#department-filter");
const statusFilter = document.querySelector("#status-filter");
const toast = document.querySelector("#toast");
const registryRows = document.querySelector("#registry-rows");
const registryEmpty = document.querySelector("#registry-empty");
const registryForm = document.querySelector("#registry-upload-form");
const registryUploadButton = document.querySelector("#registry-upload-button");
const registryEmployeeSelect = document.querySelector("#registry-employee");
const registryFilter = document.querySelector("#registry-filter");
const registrySearch = document.querySelector("#registry-search");
const registryError = document.querySelector("#registry-error");

let employees = [];
let registryFiles = [];
let editingId = null;
let toastTimeout;
const maxRegistryFileSize = 10 * 1024 * 1024;

const avatarColors = [
  ["#f4e9ff", "#805db7"],
  ["#ffefe6", "#c67c56"],
  ["#e5f5ee", "#4c9678"],
  ["#e9efff", "#5974bd"],
  ["#fff2d9", "#b18636"],
  ["#fce7ed", "#bb6980"],
  ["#e3f3f5", "#438994"],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function initials(employee) {
  return `${employee.firstName?.[0] || ""}${employee.lastName?.[0] || ""}`.toUpperCase();
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function setToday() {
  document.querySelector("#today-label").textContent =
    new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

function updateStats() {
  const departments = new Set(employees.map((employee) => employee.department));
  document.querySelector("#total-count").textContent = employees.length;
  document.querySelector("#active-count").textContent = employees.filter((employee) => employee.status === "Active").length;
  document.querySelector("#department-count").textContent = departments.size;
  document.querySelector("#leave-count").textContent = employees.filter((employee) => employee.status === "On Leave").length;
  document.querySelector("#team-count").textContent = employees.length;
  document.querySelector("#nav-count").textContent = employees.length;

  const currentDepartment = departmentFilter.value;
  const sortedDepartments = [...departments].sort((a, b) => a.localeCompare(b));
  departmentFilter.innerHTML = '<option value="">All departments</option>' + sortedDepartments
    .map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`)
    .join("");
  if (sortedDepartments.includes(currentDepartment)) departmentFilter.value = currentDepartment;
  document.querySelector("#department-options").innerHTML = sortedDepartments
    .map((department) => `<option value="${escapeHtml(department)}"></option>`)
    .join("");

  const sortedEmployees = [...employees].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  const currentEmployee = registryEmployeeSelect.value;
  const currentRegistryFilter = registryFilter.value;
  const employeeOptions = sortedEmployees.map((employee) =>
    `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}</option>`)
    .join("");
  registryEmployeeSelect.innerHTML = `<option value="">Choose an employee</option>${employeeOptions}`;
  registryFilter.innerHTML = `<option value="">All employees</option>${employeeOptions}`;
  if (sortedEmployees.some((employee) => employee.id === currentEmployee)) registryEmployeeSelect.value = currentEmployee;
  if (sortedEmployees.some((employee) => employee.id === currentRegistryFilter)) registryFilter.value = currentRegistryFilter;
}

function filteredEmployees() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const department = departmentFilter.value;
  const status = statusFilter.value;

  return employees.filter((employee) => {
    const searchable = [
      employee.firstName, employee.lastName, employee.email, employee.position,
      employee.department, employee.location, employee.phone,
    ].join(" ").toLocaleLowerCase();
    return (!query || searchable.includes(query))
      && (!department || employee.department === department)
      && (!status || employee.status === status);
  });
}

function renderEmployees() {
  const visibleEmployees = filteredEmployees();
  rowsElement.innerHTML = visibleEmployees.map((employee, index) => {
    const statusClass = employee.status === "Active" ? "status-active"
      : employee.status === "On Leave" ? "status-leave" : "status-inactive";

    return `<tr>
      <td><div class="person-cell">
        <span class="person-avatar color-${index % avatarColors.length}">${escapeHtml(initials(employee))}</span>
        <span class="person-name"><strong>${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}</strong><span>${escapeHtml(employee.email)}</span></span>
      </div></td>
      <td><div class="role-cell"><strong>${escapeHtml(employee.position)}</strong><span>${escapeHtml(employee.department)}</span></div></td>
      <td><span class="status-badge ${statusClass}">${escapeHtml(employee.status)}</span></td>
      <td class="date-cell">${escapeHtml(formatDate(employee.startDate))}</td>
      <td class="location-cell">${escapeHtml(employee.location || "—")}</td>
      <td><div class="row-actions">
        <button class="row-action" type="button" data-action="edit" data-id="${escapeHtml(employee.id)}" aria-label="Edit ${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/></svg>
        </button>
        <button class="row-action delete" type="button" data-action="delete" data-id="${escapeHtml(employee.id)}" aria-label="Delete ${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join("");

  loadingElement.hidden = true;
  emptyElement.hidden = visibleEmployees.length > 0;
  document.querySelector("#empty-title").textContent = employees.length ? "No people found" : "Your people are waiting";
  document.querySelector("#empty-message").textContent = employees.length
    ? "Try another search or adjust your filters."
    : "Add your first employee to get your directory started.";
  document.querySelector("#clear-filters-button").hidden = employees.length === 0;
  document.querySelector("#results-label").textContent = visibleEmployees.length === employees.length
    ? `${employees.length} ${employees.length === 1 ? "person" : "people"}`
    : `${visibleEmployees.length} of ${employees.length} people`;
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function filteredRegistryFiles() {
  const query = registrySearch.value.trim().toLocaleLowerCase();
  const employeeId = registryFilter.value;
  return registryFiles.filter((file) =>
    (!query || `${file.fileNumber || ""} ${file.name} ${file.employeeName}`.toLocaleLowerCase().includes(query))
    && (!employeeId || file.employeeId === employeeId));
}

function renderRegistry() {
  const visibleFiles = filteredRegistryFiles();
  registryRows.innerHTML = visibleFiles.map((file) => `<tr>
    <td>${escapeHtml(file.fileNumber || "—")}</td>
    <td><div class="registry-file-name">
      <span class="registry-file-icon" aria-hidden="true">↗</span>
      <a href="/api/registry/${encodeURIComponent(file.id)}">${escapeHtml(file.name)}</a>
    </div></td>
    <td>${escapeHtml(file.employeeName)}</td>
    <td>${escapeHtml(formatDate(file.uploadedAt.slice(0, 10)))}</td>
    <td>${escapeHtml(formatFileSize(file.size))}</td>
    <td><div class="row-actions">
      <a class="row-action" href="/api/registry/${encodeURIComponent(file.id)}" aria-label="Download ${escapeHtml(file.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v3h14v-3"/></svg>
      </a>
      <button class="row-action delete" type="button" data-registry-action="delete" data-id="${escapeHtml(file.id)}" aria-label="Delete ${escapeHtml(file.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button>
    </div></td>
  </tr>`).join("");

  document.querySelector("#registry-total").textContent = registryFiles.length;
  document.querySelector("#registry-count").textContent = registryFiles.length;
  document.querySelector("#registry-results").textContent = `${visibleFiles.length} ${visibleFiles.length === 1 ? "file" : "files"}`;
  registryEmpty.hidden = visibleFiles.length > 0;
  if (!visibleFiles.length) {
    registryEmpty.textContent = registryFiles.length
      ? "No files match your search or employee filter."
      : "No files in the registry yet. Add a file above to get started.";
  }
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const result = await response.json();
      if (result.error) message = result.error;
    } catch {
      // The server response did not include a JSON error message.
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function showToast(message, isError = false) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function loadEmployees() {
  loadingElement.hidden = false;
  emptyElement.hidden = true;
  try {
    employees = await request("/api/employees");
    updateStats();
    renderEmployees();
  } catch (error) {
    loadingElement.hidden = true;
    emptyElement.hidden = false;
    document.querySelector("#empty-title").textContent = "We couldn't load your people";
    document.querySelector("#empty-message").textContent = error.message;
    document.querySelector("#clear-filters-button").hidden = true;
    document.querySelector("#results-label").textContent = "Unable to load employees";
  }
}

async function loadRegistry() {
  registryEmpty.hidden = false;
  registryEmpty.textContent = "Loading registry files...";
  try {
    registryFiles = await request("/api/registry");
    renderRegistry();
  } catch (error) {
    registryRows.innerHTML = "";
    registryEmpty.hidden = false;
    registryEmpty.textContent = `We couldn't load the registry: ${error.message}`;
    document.querySelector("#registry-results").textContent = "Unable to load files";
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const separator = result.indexOf(",");
      if (separator === -1) {
        reject(new Error("Couldn't read the selected file."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("Couldn't read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function uploadRegistryFile(event) {
  event.preventDefault();
  registryError.hidden = true;
  const file = registryForm.elements.namedItem("file").files[0];
  if (!file) return;
  if (file.size > maxRegistryFileSize) {
    registryError.textContent = "Files must be 10 MB or smaller.";
    registryError.hidden = false;
    return;
  }

  registryUploadButton.disabled = true;
  registryUploadButton.textContent = "Adding file...";
  try {
    const contentBase64 = await readFileAsBase64(file);
    await request("/api/registry", {
      method: "POST",
      body: JSON.stringify({
        fileNumber: registryForm.elements.namedItem("fileNumber").value,
        employeeId: registryEmployeeSelect.value,
        name: file.name,
        contentBase64,
      }),
    });
    registryForm.reset();
    await loadRegistry();
    showToast("File added to the registry.");
  } catch (error) {
    registryError.textContent = error.message;
    registryError.hidden = false;
  } finally {
    registryUploadButton.disabled = false;
    registryUploadButton.textContent = "Add to registry";
  }
}

async function deleteRegistryFile(id) {
  const file = registryFiles.find((item) => item.id === id);
  if (!file || !window.confirm(`Delete "${file.name}" from the registry? This cannot be undone.`)) return;
  try {
    await request(`/api/registry/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadRegistry();
    showToast("File removed from the registry.");
  } catch (error) {
    showToast(error.message, true);
  }
}

function openDialog(employee) {
  editingId = employee?.id || null;
  form.reset();
  formError.hidden = true;
  formError.textContent = "";
  document.querySelector("#dialog-title").textContent = editingId ? "Update their details" : "Add a person";
  saveButton.innerHTML = editingId ? 'Save changes <span aria-hidden="true">↗</span>' : 'Save employee <span aria-hidden="true">↗</span>';

  if (employee) {
    for (const [key, value] of Object.entries(employee)) {
      const field = form.elements.namedItem(key);
      if (field && key !== "id") field.value = value ?? "";
    }
  } else {
    form.elements.namedItem("startDate").value = new Date().toISOString().slice(0, 10);
    form.elements.namedItem("status").value = "Active";
  }
  dialog.showModal();
  form.elements.namedItem("firstName").focus();
}

function closeDialog() {
  dialog.close();
}

async function saveEmployee(event) {
  event.preventDefault();
  const formData = new FormData(form);
  const details = Object.fromEntries(formData.entries());
  details.salary = details.salary === "" ? null : Number(details.salary);
  saveButton.disabled = true;
  saveButton.textContent = editingId ? "Saving changes..." : "Saving employee...";
  formError.hidden = true;

  try {
    const url = editingId ? `/api/employees/${encodeURIComponent(editingId)}` : "/api/employees";
    await request(url, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(details) });
    closeDialog();
    await loadEmployees();
    showToast(editingId ? "Employee details updated." : "Employee added to your team.");
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = editingId ? 'Save changes <span aria-hidden="true">↗</span>' : 'Save employee <span aria-hidden="true">↗</span>';
  }
}

async function deleteEmployee(id) {
  const employee = employees.find((item) => item.id === id);
  if (!employee) return;
  if (!window.confirm(`Remove ${employee.firstName} ${employee.lastName} from the employee directory?`)) return;

  try {
    await request(`/api/employees/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadEmployees();
    showToast(`${employee.firstName} ${employee.lastName} was removed.`);
  } catch (error) {
    showToast(error.message, true);
  }
}

function exportEmployees() {
  const visibleEmployees = filteredEmployees();
  if (!visibleEmployees.length) {
    showToast("There are no employees to export.", true);
    return;
  }
  const columns = [
    ["First name", "firstName"], ["Last name", "lastName"], ["Email", "email"],
    ["Phone", "phone"], ["Department", "department"], ["Position", "position"],
    ["Status", "status"], ["Start date", "startDate"], ["Location", "location"], ["Annual salary", "salary"],
  ];
  const csv = [columns.map(([label]) => label), ...visibleEmployees.map((employee) =>
    columns.map(([, key]) => employee[key] ?? ""))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "borno-state-government-employees.csv";
  link.click();
  URL.revokeObjectURL(url);
  showToast(`${visibleEmployees.length} ${visibleEmployees.length === 1 ? "record" : "records"} exported.`);
}

document.querySelector("#add-employee-button").addEventListener("click", () => openDialog());
document.querySelector("#close-dialog-button").addEventListener("click", closeDialog);
document.querySelector("#cancel-dialog-button").addEventListener("click", closeDialog);
document.querySelector("#export-button").addEventListener("click", exportEmployees);
form.addEventListener("submit", saveEmployee);
searchInput.addEventListener("input", renderEmployees);
departmentFilter.addEventListener("change", renderEmployees);
statusFilter.addEventListener("change", renderEmployees);
document.querySelector("#clear-filters-button").addEventListener("click", () => {
  searchInput.value = "";
  departmentFilter.value = "";
  statusFilter.value = "";
  renderEmployees();
});
rowsElement.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const employee = employees.find((item) => item.id === button.dataset.id);
  if (button.dataset.action === "edit" && employee) openDialog(employee);
  if (button.dataset.action === "delete") deleteEmployee(button.dataset.id);
});
registryRows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-registry-action='delete']");
  if (button) deleteRegistryFile(button.dataset.id);
});
registryForm.addEventListener("submit", uploadRegistryFile);
registrySearch.addEventListener("input", renderRegistry);
registryFilter.addEventListener("change", renderRegistry);
function updateActiveNavigation() {
  const currentHash = location.hash;
  document.querySelectorAll(".side-nav .nav-link").forEach((link) => {
    const active = link.getAttribute("href") === currentHash
      || (!currentHash && link.getAttribute("href") === "#employees");
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", updateActiveNavigation);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
});

setToday();
updateActiveNavigation();
loadEmployees();
loadRegistry();
