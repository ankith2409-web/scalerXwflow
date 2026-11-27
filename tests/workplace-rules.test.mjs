import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compare} from '../server/workplace-rules.mjs';
const job=(place,landmark='railway crossing',alias='Raju shed',period=null)=>({fields:{place,landmark,alias,period,task:'cut stone'}});
const fixtures=[
  ['English city aliases',job('Bangalore'),job('Bengaluru'),true],
  ['Hindi locality',job('Jodhpur'),job('जोधपुर'),true],
  ['Kannada locality',job('Bengaluru'),job('ಬೆಂಗಳೂರು'),true],
  ['Mysuru aliases',job('Mysore'),job('ಮೈಸೂರು'),true],
  ['Tumakuru aliases',job('Tumkur'),job('ತುಮಕೂರು'),true],
  ['Explicit same region',job('Jodhpur, Rajasthan'),job('जोधपुर, राजस्थान'),true],
  ['Explicit conflicting regions',job('Jodhpur, Karnataka'),job('Jodhpur, Rajasthan'),false],
  ['Repeated name across cities',job('Jodhpur'),job('Jaipur'),false],
  ['Unknown towns exact',job('Village A'),job('Village A'),true],
  ['Unknown towns conflicting regions',job('Village A, District D'),job('Village A, District E'),false],
  ['Similar spelling is insufficient',job('Village A'),job('Village AA'),false],
  ['Missing locality',job(null),job('Jodhpur'),false],
  ['Missing evidence',job('Jodhpur',null,null),job('Jodhpur',null,null),false],
  ['Hindi landmark',job('Jodhpur','रेलवे फाटक',null),job('Jodhpur','rail crossing',null),true],
  ['Kannada landmark',job('Bengaluru','ರೈಲ್ವೆ ಗೇಟ್',null),job('Bengaluru','railway crossing',null),true],
  ['Multiple cities require review',job('Bengaluru and Mysuru'),job('Bengaluru'),false],
];
for(const [name,a,b,expected] of fixtures)test('matching benchmark: '+name,()=>assert.equal(compare(a,b).eligible,expected));
test('non-Latin years compare without inventing an event date',()=>{
  assert.equal(compare(job('Jaipur',null,'Raju','२०१८–२०१९'),job('Jaipur',null,'Raju','೨೦೧೯')).overlap,'overlap');
  assert.equal(compare(job('Jaipur',null,'Raju','before lockdown'),job('Jaipur',null,'Raju','2019')).overlap,'unknown');
});
