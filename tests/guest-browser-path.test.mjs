import test from 'node:test';import assert from 'node:assert/strict';import {guestBrowserPath} from './guest-browser-path.mjs';
test('default test browser preserves original executable and platform availability behavior',()=>{
 assert.deepEqual(guestBrowserPath({requested:undefined,exists:p=>p==='/usr/bin/chromium'}),{executable:'/usr/bin/chromium',skip:false});
 assert.deepEqual(guestBrowserPath({requested:undefined,exists:()=>false}),{executable:'/usr/bin/chromium',skip:true});
});
test('explicit existing stable browser cannot be silently skipped or substituted',()=>{
 assert.deepEqual(guestBrowserPath({platform:'linux',requested:'/usr/bin/google-chrome',exists:()=>true}),{executable:'/usr/bin/google-chrome',skip:false});
 assert.throws(()=>guestBrowserPath({platform:'linux',requested:'/usr/bin/google-chrome',exists:()=>false}),/REQUIRED_MISSING/);
 for(const requested of ['', '/bin/true','/tmp/browser','/usr/bin/google-chrome; true'])assert.throws(()=>guestBrowserPath({platform:'linux',requested,exists:()=>true}),/SELECTION_REJECTED/);
 assert.throws(()=>guestBrowserPath({platform:'win32',requested:'/usr/bin/google-chrome',exists:()=>true}),/SELECTION_REJECTED/);
});
