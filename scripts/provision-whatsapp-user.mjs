import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { generateSecret, generateURI } from "otplib";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const schemaPath = join(repoRoot, "packages", "db", "src", "schema.sql");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = "true";
      continue;
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function appKey() {
  const raw = process.env.FIELD_ENCRYPTION_KEY ?? process.env.APP_SIGNING_SECRET ?? "development-only-key";
  if (/^[A-Za-z0-9+/=]{43,}$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length >= 32) return decoded.subarray(0, 32);
    } catch {
      // ignore and derive below
    }
  }
  return createHash("sha256").update(raw).digest();
}

function encryptText(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function hashCpf(cpf) {
  return createHash("sha256").update(String(cpf).replace(/\D/g, "")).digest("hex");
}

function normalizeCpf(cpf) {
  return String(cpf).replace(/\D/g, "");
}

function buildEmployeeNumber(inputName) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const initials = inputName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() ?? "")
    .join("");
  return `ALC-${initials || "USR"}-${today}-001`;
}

function buildPassword() {
  return "Wesley@TicketLog2026!";
}

function buildPgClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const isPublicRailwayProxy = connectionString.includes("proxy.rlwy.net");
  return new Client({
    connectionString,
    ...(isPublicRailwayProxy ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

async function ensureSchema(client) {
  const sql = await readFile(schemaPath, "utf8");
  await client.query(sql);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name ?? "Wesley Oliveira";
  const cpf = normalizeCpf(args.cpf ?? "44214899806");
  const email = (args.email ?? "wesley.oliveira@alcepereirafilho.com.br").toLowerCase();
  const phoneE164 = args.phone ?? "+5516992999312";
  const operationScope = args.scope ?? "GERAL";
  const employeeNumber = args.employeeNumber ?? buildEmployeeNumber(name);
  const password = args.password ?? buildPassword();
  const roleNames = (args.roles ?? "SOLICITANTE")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const companyName = process.env.COMPANY_NAME ?? "ALC & Pereira Filho Transportes";
  const mfaSecret = args.mfaSecret ?? generateSecret();
  const otpauthUrl = generateURI({
    issuer: companyName,
    label: email,
    secret: mfaSecret,
  });

  const client = buildPgClient();
  await client.connect();

  try {
    await ensureSchema(client);
    await client.query("begin");

    const userResult = await client.query(
      `insert into users(
         name,
         employee_number,
         corporate_email,
         cpf_hash,
         cpf_last4,
         operation_scope,
         password_hash,
         password_changed_at,
         mfa_secret_encrypted,
         mfa_enabled,
         mfa_enrolled_at,
         status
       ) values ($1,$2,$3,$4,$5,$6,$7,now(),$8,true,now(),'active')
       on conflict (corporate_email)
       do update set
         name = excluded.name,
         employee_number = excluded.employee_number,
         cpf_hash = excluded.cpf_hash,
         cpf_last4 = excluded.cpf_last4,
         operation_scope = excluded.operation_scope,
         password_hash = excluded.password_hash,
         password_changed_at = now(),
         mfa_secret_encrypted = excluded.mfa_secret_encrypted,
         mfa_enabled = true,
         mfa_enrolled_at = now(),
         status = 'active'
       returning id, name, employee_number, corporate_email`,
      [
        name,
        employeeNumber,
        email,
        hashCpf(cpf),
        cpf.slice(-4),
        operationScope,
        hashPassword(password),
        encryptText(mfaSecret),
      ],
    );

    const user = userResult.rows[0];

    await client.query(
      `insert into authorized_phones(user_id, phone_e164, verified_at)
       values ($1, $2, now())
       on conflict (phone_e164)
       do update set user_id = excluded.user_id, verified_at = now(), revoked_at = null`,
      [user.id, phoneE164],
    );

    for (const roleName of roleNames) {
      await client.query(
        `insert into user_roles(user_id, role_id)
         select $1, id from roles where name = $2
         on conflict do nothing`,
        [user.id, roleName],
      );
    }

    await client.query("commit");

    const artifactDir = join(repoRoot, "artifacts");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, `whatsapp-user-${email.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`);
    const artifact = {
      createdAt: new Date().toISOString(),
      user: {
        id: user.id,
        name,
        email,
        employeeNumber,
        phoneE164,
        operationScope,
        roles: roleNames,
      },
      login: {
        email,
        password,
      },
      mfa: {
        secret: mfaSecret,
        otpauthUrl,
      },
    };
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    console.log(
      JSON.stringify(
        {
          ok: true,
          userId: user.id,
          email,
          employeeNumber,
          phoneE164,
          roles: roleNames,
          artifactPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
