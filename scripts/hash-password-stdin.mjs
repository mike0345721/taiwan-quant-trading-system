import { hashPassword } from '../src/security.mjs';

let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');

try {
  console.log(hashPassword(password));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
