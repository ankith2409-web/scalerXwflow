import {discoverWispr} from '../server/wispr.mjs';
// Public metadata only: no client registration, OAuth grant, token or meeting access.
const calls=[];
try{
  const endpoints=await discoverWispr(async(url,init)=>{
    const response=await fetch(url,init);calls.push({url,status:response.status});return response;
  });
  console.log(JSON.stringify({publicDiscovery:'passed',authorizationHost:new URL(endpoints.authorization).host,registrationAvailable:true,requests:calls}));
}catch(error){console.error(JSON.stringify({publicDiscovery:'failed',message:error.message,requests:calls}));process.exitCode=1;}
