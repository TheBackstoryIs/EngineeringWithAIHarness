import {executeProjectCheck} from './project-checks.mjs';

// Inputs select a server-created attempt, never an executable or command line.
const [root,slug,id]=process.argv.slice(2);
try {await executeProjectCheck(root,slug,id);}catch{process.exitCode=1;}
