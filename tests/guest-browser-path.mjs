// Test-only browser selection for a measured runner dependency comparison. No fallback.
import fs from 'node:fs';
export function guestBrowserPath(options={}) {
 const platform=options.platform??process.platform;
 const requested=Object.hasOwn(options,'requested')?options.requested:process.env.CRU21_TEST_BROWSER_PATH;
 const exists=options.exists||fs.existsSync, defaultPath='/usr/bin/chromium';
 if(requested===undefined)return {executable:defaultPath,skip:!exists(defaultPath)};
 if(platform!=='linux'||!['/usr/bin/chromium','/usr/bin/google-chrome'].includes(requested))throw Error('TEST_BROWSER_SELECTION_REJECTED');
 if(!exists(requested))throw Error('TEST_BROWSER_REQUIRED_MISSING');
 return {executable:requested,skip:false};
}
