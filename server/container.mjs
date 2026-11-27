import { createApp } from './index.mjs';
// Compose exposes this only on the host's loopback interface. No keys are required.
const server = createApp({dbPath:'/app/data/workecho.sqlite',workspace:true,speechKey:''});
server.listen(3000,'0.0.0.0',()=>console.log('WorkEcho: http://localhost:3000'));
process.on('SIGTERM',()=>server.close());
