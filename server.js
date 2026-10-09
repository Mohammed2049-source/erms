const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "employees.json");
const REGISTRY_FILE = path.join(ROOT, "data", "registry.json");
const REGISTRY_DIR = path.join(ROOT, "data", "registry");
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_SIZE = 1024 * 1024;
const MAX_REGISTRY_FILE_SIZE = 10 * 1024 * 1024;
const MAX_REGISTRY_BODY_SIZE = Math.ceil(MAX_REGISTRY_FILE_SIZE / 3) * 4 + 16 * 1024;
const STATUSES = new Set(["Active", "On Leave", "Inactive"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

let writeQueue = Promise.resolve();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readEmployees() {
  try {
    const contents = await fs.readFile(DATA_FILE, "utf8");
    const employees = JSON.parse(contents);
    if (!Array.isArray(employees)) {
      throw new Error("Employee data must be an array.");
    }
    return employees;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readRegistry() {
  try {
    const contents = await fs.readFile(REGISTRY_FILE, "utf8");
    const files = JSON.parse(contents);
    if (!Array.isArray(files)) {
      throw new Error("Registry data must be an array.");
    }
    return files;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  const temporaryFile = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, filePath);
  } catch (error) {
    try {
      await fs.unlink(temporaryFile);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") console.error("Unable to remove temporary data file:", cleanupError);
    }
    throw error;
  }
}

function serializeWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
}

function updateEmployees(update) {
  return serializeWrite(async () => {
    const employees = await readEmployees();
    const result = update(employees);
    await writeJsonFile(DATA_FILE, employees);
    return result;
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, maxSize = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceededLimit = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        exceededLimit = true;
        reject(new HttpError(413, "Request body is too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceededLimit) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function validateEmployee(input, existing) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Employee details must be a JSON object.");
  }

  const employee = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone || "",
    department: input.department,
    position: input.position,
    status: input.status || "Active",
    startDate: input.startDate,
    salary: input.salary === "" || input.salary == null ? null : Number(input.salary),
    location: input.location || "",
  };

  const requiredFields = ["firstName", "lastName", "email", "department", "position", "startDate"];
  for (const field of requiredFields) {
    if (typeof employee[field] !== "string" || !employee[field].trim()) {
      throw new HttpError(400, `${field} is required.`);
    }
    employee[field] = employee[field].trim();
  }

  const limits = {
    firstName: 80,
    lastName: 80,
    email: 254,
    phone: 40,
    department: 100,
    position: 120,
    location: 120,
  };
  for (const [field, limit] of Object.entries(limits)) {
    if (employee[field].length > limit) {
      throw new HttpError(400, `${field} must be ${limit} characters or fewer.`);
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  employee.email = employee.email.toLowerCase();

  if (!STATUSES.has(employee.status)) {
    throw new HttpError(400, "Choose a valid employee status.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(employee.startDate)
    || Number.isNaN(Date.parse(`${employee.startDate}T00:00:00Z`))
    || new Date(`${employee.startDate}T00:00:00Z`).toISOString().slice(0, 10) !== employee.startDate) {
    throw new HttpError(400, "Enter a valid start date.");
  }
  if (employee.salary !== null && (!Number.isFinite(employee.salary) || employee.salary < 0)) {
    throw new HttpError(400, "Salary must be a non-negative number.");
  }

  const duplicate = existing.find((item) =>
    item.email.toLowerCase() === employee.email && item.id !== (input.id || null));
  if (duplicate) {
    throw new HttpError(409, "An employee with this email address already exists.");
  }

  return employee;
}

function validateRegistryUpload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "File details must be a JSON object.");
  }
  if (typeof input.employeeId !== "string" || !input.employeeId.trim()) {
    throw new HttpError(400, "Choose an employee for this file.");
  }
  if (typeof input.fileNumber !== "string" || !input.fileNumber.trim()) {
    throw new HttpError(400, "Enter a file number.");
  }
  const fileNumber = input.fileNumber.trim();
  if (fileNumber.length > 80) {
    throw new HttpError(400, "File number must be 80 characters or fewer.");
  }
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new HttpError(400, "Choose a file to upload.");
  }

  const name = input.name.trim().replace(/\\/g, "/").split("/").pop()
    .replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255);
  if (!name) throw new HttpError(400, "Enter a valid file name.");
  if (typeof input.contentBase64 !== "string") {
    throw new HttpError(400, "The uploaded file data is invalid.");
  }
  if (input.contentBase64.length > Math.ceil(MAX_REGISTRY_FILE_SIZE / 3) * 4) {
    throw new HttpError(413, "Files must be 10 MB or smaller.");
  }
  if (/[^A-Za-z0-9+/=]/.test(input.contentBase64)) {
    throw new HttpError(400, "The uploaded file data is invalid.");
  }

  const contents = Buffer.from(input.contentBase64, "base64");
  if (contents.toString("base64") !== input.contentBase64) {
    throw new HttpError(400, "The uploaded file data is invalid.");
  }
  if (contents.length > MAX_REGISTRY_FILE_SIZE) {
    throw new HttpError(413, "Files must be 10 MB or smaller.");
  }
  return { fileNumber, name, contents };
}

async function handleApi(request, response, url) {
  const employeePath = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
  const registryFilePath = url.pathname.match(/^\/api\/registry\/([^/]+)$/);
  if (url.pathname === "/api/registry" && request.method === "GET") {
    const files = await readRegistry();
    files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return sendJson(response, 200, files.map(({ storedName, ...file }) => file));
  }

  if (url.pathname === "/api/registry" && request.method === "POST") {
    const input = await readJsonBody(request, MAX_REGISTRY_BODY_SIZE);
    const { fileNumber, name, contents } = validateRegistryUpload(input);
    const record = await serializeWrite(async () => {
      const employees = await readEmployees();
      const employee = employees.find((item) => item.id === input.employeeId);
      if (!employee) throw new HttpError(404, "Choose an employee that still exists.");

      const files = await readRegistry();
      const id = randomUUID();
      const storedName = `${id}.bin`;
      await fs.writeFile(path.join(REGISTRY_DIR, storedName), contents, { flag: "wx" });
      const uploadedFile = {
        id,
        fileNumber,
        name,
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        size: contents.length,
        uploadedAt: new Date().toISOString(),
        storedName,
      };
      try {
        await writeJsonFile(REGISTRY_FILE, [...files, uploadedFile]);
      } catch (error) {
        try {
          await fs.unlink(path.join(REGISTRY_DIR, storedName));
        } catch (cleanupError) {
          if (cleanupError.code !== "ENOENT") console.error("Unable to remove incomplete registry upload:", cleanupError);
        }
        throw error;
      }
      return uploadedFile;
    });
    const { storedName, ...publicRecord } = record;
    return sendJson(response, 201, publicRecord);
  }

  if (registryFilePath && request.method === "GET") {
    const id = decodeURIComponent(registryFilePath[1]);
    const file = (await readRegistry()).find((item) => item.id === id);
    if (!file) throw new HttpError(404, "Registry file not found.");
    const contents = await fs.readFile(path.join(REGISTRY_DIR, file.storedName));
    const safeName = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encodedName = encodeURIComponent(Buffer.from(file.name, "utf8").toString("utf8"))
      .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": contents.length,
      "Content-Type": "application/octet-stream",
    });
    return response.end(contents);
  }

  if (registryFilePath && request.method === "DELETE") {
    const id = decodeURIComponent(registryFilePath[1]);
    await serializeWrite(async () => {
      const files = await readRegistry();
      const index = files.findIndex((item) => item.id === id);
      if (index === -1) throw new HttpError(404, "Registry file not found.");
      const [file] = files.splice(index, 1);
      await writeJsonFile(REGISTRY_FILE, files);
      await fs.unlink(path.join(REGISTRY_DIR, file.storedName));
    });
    response.writeHead(204, { "Cache-Control": "no-store" });
    return response.end();
  }

  if (url.pathname === "/api/employees" && request.method === "GET") {
    const employees = await readEmployees();
    employees.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    return sendJson(response, 200, employees);
  }

  if (url.pathname === "/api/employees" && request.method === "POST") {
    const input = await readJsonBody(request);
    const employee = await updateEmployees((employees) => {
      const details = validateEmployee(input, employees);
      const created = { id: randomUUID(), ...details, createdAt: new Date().toISOString() };
      employees.push(created);
      return created;
    });
    return sendJson(response, 201, employee);
  }

  if (employeePath && request.method === "PATCH") {
    const id = decodeURIComponent(employeePath[1]);
    const input = await readJsonBody(request);
    const employee = await updateEmployees((employees) => {
      const index = employees.findIndex((item) => item.id === id);
      if (index === -1) throw new HttpError(404, "Employee not found.");
      const details = validateEmployee({ ...employees[index], ...input, id }, employees);
      const updated = { ...employees[index], ...details, updatedAt: new Date().toISOString() };
      employees[index] = updated;
      return updated;
    });
    return sendJson(response, 200, employee);
  }

  if (employeePath && request.method === "DELETE") {
    const id = decodeURIComponent(employeePath[1]);
    await updateEmployees((employees) => {
      const index = employees.findIndex((item) => item.id === id);
      if (index === -1) throw new HttpError(404, "Employee not found.");
      employees.splice(index, 1);
    });
    response.writeHead(204, { "Cache-Control": "no-store" });
    return response.end();
  }

  if (url.pathname === "/api/employees" || employeePath || url.pathname === "/api/registry" || registryFilePath) {
    response.setHeader("Allow", employeePath ? "PATCH, DELETE" : registryFilePath ? "GET, DELETE" : "GET, POST");
    throw new HttpError(405, "Method not allowed.");
  }

  throw new HttpError(404, "API endpoint not found.");
}

async function handleStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    throw new HttpError(405, "Method not allowed.");
  }

  const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!["index.html", "styles.css", "app.js"].includes(fileName)) {
    throw new HttpError(404, "Page not found.");
  }
  const filePath = path.join(PUBLIC_DIR, fileName);
  const contents = await fs.readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": contents.length,
    "Content-Type": MIME_TYPES[path.extname(filePath)],
  });
  response.end(request.method === "HEAD" ? undefined : contents);
}

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      await handleStatic(request, response, url.pathname);
    }
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? "An unexpected server error occurred." : error.message });
  }
});

async function start() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  server.listen(PORT, HOST, () => {
    console.log(`Employee Record Management System is running at http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Unable to start the server:", error);
  process.exitCode = 1;
});
