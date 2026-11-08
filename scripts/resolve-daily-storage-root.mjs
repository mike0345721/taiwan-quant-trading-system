// PowerShell replay bridge: metadata-only validation before any storage write.
import { dailyStorageRoots, assertDailyArguments } from '../src/daily-storage-binding.mjs';
assertDailyArguments();
console.log(dailyStorageRoots().storageAppRoot);
