# Borno State Government Employee Records

A full-stack employee record management system for Borno State Government with a responsive browser interface and a Node.js REST API. It has no third-party runtime dependencies and stores employee records in `data/employees.json`.

## Run locally

Requires Node.js 18 or later.

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use a different port or `HOST` to choose the bind address. The server binds to `127.0.0.1` by default.

The app starts with sample employee records. Changes made through the interface are saved to `data/employees.json`.

## Features

- Employee dashboard with total, active, department, and leave counts.
- Create, edit, and remove employee records.
- Search by name, email, role, department, location, or phone.
- Filter by department and employment status.
- Export the current filtered results as CSV.
- Server-side validation for required fields, email addresses, dates, salary, status, and duplicate email addresses.

## API

All API responses use JSON except successful deletes, which return `204 No Content`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/employees` | List all employees |
| `POST` | `/api/employees` | Create an employee |
| `PATCH` | `/api/employees/:id` | Update an employee |
| `DELETE` | `/api/employees/:id` | Delete an employee |

Employee fields: `firstName`, `lastName`, `email`, `department`, `position`, and `startDate` are required. `phone`, `status` (defaults to `Active`), `salary`, and `location` are optional.

## Data and security notes

This app has no sign-in or role-based access control and is intended for local use. Do not expose it to a network or use it for real employee data without adding authentication and authorization. The JSON file is suitable for local use and small deployments; use a transactional database for multi-instance or high-concurrency production deployments. The API validates and serializes writes, returns explicit errors, and the static server only serves the app's three public assets.
