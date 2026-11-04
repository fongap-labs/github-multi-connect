// Fetch the exact upstream bridge; Action Worker requires byte-identical workflow content.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const url='https://raw.githubusercontent.com/fongap-labs/action-worker/main/templates/bridge/notify-action-worker.yml';
const response=await fetch(url,{headers:{'Accept':'text/plain'},redirect:'error',signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error(`Cannot retrieve upstream bridge: HTTP ${response.status}`);
const text=await response.text();
if(!text.startsWith('name: Notify Action Worker\n')|| !text.includes('run-pr-governance') || !text.includes('run-intake') || !text.includes('cancel-pr-work'))throw Error('Unexpected bridge content; refusing to install');
const folder=resolve('.github/workflows');
await mkdir(folder,{recursive:true});
await writeFile(resolve(folder,'notify-action-worker.yml'),text,{flag:'w'});
console.log('Updated .github/workflows/notify-action-worker.yml from the Action Worker approved template.');
