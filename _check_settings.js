const prisma = require('./src/config/prisma');

async function main() {
  const rows = await prisma.app_settings.findMany({
    where: { setting_key: { contains: 'bankeu' } }
  });
  rows.forEach(r => console.log(r.setting_key, '=', r.setting_value));
  await prisma['$disconnect']();
}

main();
