import { getPool, closePool } from "./client.js";
import { scryptSync, randomBytes } from "node:crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const client = getPool();
  const passwordHash = hashPassword("Dev@123456");
  await client.query(`
    insert into users(id, name, employee_number, corporate_email, status)
    values (
      '00000000-0000-0000-0000-000000000001',
      'Usuario Desenvolvimento',
      'DEV-001',
      'dev@example.com',
      'active'
    )
    on conflict (id) do nothing;

    insert into users(id, name, employee_number, corporate_email, status)
    values (
      '00000000-0000-0000-0000-000000000002',
      'Aprovador Desenvolvimento',
      'DEV-002',
      'approver@example.com',
      'active'
    )
    on conflict (id) do nothing;
  `);
  await client.query(
    `update users
        set password_hash = coalesce(password_hash, $2),
            password_changed_at = coalesce(password_changed_at, now())
      where id = $1`,
    ["00000000-0000-0000-0000-000000000001", passwordHash],
  );
  await client.query(
    `update users
        set password_hash = coalesce(password_hash, $2),
            password_changed_at = coalesce(password_changed_at, now())
      where id = $1`,
    ["00000000-0000-0000-0000-000000000002", passwordHash],
  );
  await client.query(`

    insert into authorized_phones(user_id, phone_e164, verified_at)
    values ('00000000-0000-0000-0000-000000000001', '+5500000000000', now())
    on conflict (phone_e164) do nothing;

    insert into user_roles(user_id, role_id)
    select '00000000-0000-0000-0000-000000000001', id from roles
    where name in ('SOLICITANTE', 'APROVADOR', 'ADMINISTRADOR')
    on conflict do nothing;

    insert into user_roles(user_id, role_id)
    select '00000000-0000-0000-0000-000000000002', id from roles
    where name in ('APROVADOR')
    on conflict do nothing;

    insert into limit_policies(scope_type, scope_id, max_amount, period_window, double_approval_from, active)
    values
      ('vehicle_group:GERAL_DE_RESTRICOES', null, 2000.00, '24 hours', 0.00, true),
      ('vehicle_group:VEICULO_DE_PASSEIO', null, 70.00, '24 hours', 0.00, true),
      ('vehicle_group:UTILITARIOS', null, 90.00, '24 hours', 0.00, true),
      ('vehicle_group:VAN', null, 100.00, '24 hours', 0.00, true),
      ('vehicle_group:VUC', null, 150.00, '24 hours', 0.00, true)
    on conflict do nothing;
  `);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
