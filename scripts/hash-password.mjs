import { hashPassword } from '../src/security.mjs';

const password = process.argv[2];
if (!password) {
  console.error('用法：npm run password:hash -- "至少12字元的高強度密碼"');
  process.exit(1);
}
try {
  console.log(hashPassword(password));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
