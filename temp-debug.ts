import { $ } from './src/testing/moxxy.ts'; const moxxy = $(import.meta)!; console.log('Moxxy keys:', Object.keys(moxxy)); console.log('exec in moxxy:', 'exec' in moxxy);
