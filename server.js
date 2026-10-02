const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "employees.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_SIZE = 1024 * 1024;
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

function updateEmployees(update) {
  const operation = writeQueue.then(async () => {
    const employees = await readEmployees();
    const result = update(employees);
    const temporaryFile = `${DATA_FILE}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(employees, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, DATA_FILE);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let exceededLimit = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        exceededLimit = true;
        reject(new HttpError(413, "Request body is too large."));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (exceededLimit) return;
      try {
        resolve(JSON.parse(body));
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

async function handleApi(request, response, url) {
  const employeePath = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
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

  if (url.pathname === "/api/employees" || employeePath) {
    response.setHeader("Allow", employeePath ? "PATCH, DELETE" : "GET, POST");
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
  server.listen(PORT, HOST, () => {
    console.log(`Employee Record Management System is running at http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Unable to start the server:", error);
  process.exitCode = 1;
});
