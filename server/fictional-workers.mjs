// Synthetic fixtures only. Coordinates identify illustrative areas, not actual employers.
const sites = [
  ['Bengaluru, Karnataka','Peenya industrial area','Lotus unit','Garment stitching',13.03,77.52],
  ['Mysuru, Karnataka','Hebbal industrial area','Lotus unit','Garment stitching',12.35,76.60],
  ['Tumakuru, Karnataka','Near the industrial bus stand','Blue gate foundry','Metal casting',13.34,77.10],
  ['Bengaluru, Karnataka','Near the outer ring road','East yard','Construction work',12.98,77.69],
  ['Jodhpur, Rajasthan','Near the stone market','Desert stone works','Stone polishing',26.25,73.02],
  ['Jaipur, Rajasthan','Near the industrial bus depot','Desert stone works','Stone polishing',26.85,75.80],
  ['Mysuru, Karnataka','By the goods railway yard','River warehouse','Loading sacks',12.31,76.64],
  ['Tumakuru, Karnataka','Beyond the old water tank','Red clay yard','Brick making',13.30,77.08],
];
const names=['Meera','Arun','Salma','Kiran','Dev','Anita','Imran','Lakshmi','Ravi','Noor','Asha','Suresh','Farah','Manoj','Gita','Naveen','Pooja','Iqbal','Tara','Deepak','Rekha','Yusuf','Kavya','Mohan','Sana','Vijay','Radha','Sameer','Uma','Ajay','Nisha','Prakash','Leela','Harish','Zoya','Balu','Seema','Ganesh','Rani','Faisal'];
const periods=['2014–2018','2017–2020','2022–2023',null,'Before lockdown'];
export const fictionalWorkers=sites.flatMap(([place,landmark,alias,task,lat,lon],site)=>Array.from({length:5},(_,variant)=>{
  const n=site*5+variant,number=String(n+1).padStart(2,'0');
  const fields={place,task:variant===2?'Material handling':task,period:periods[variant],landmark:variant===3?null:landmark,alias:variant===4?null:alias};
  const time=fields.period??'I do not remember the years';
  const quote=variant===3?`${place} में ${alias} पर ${fields.task} का काम किया। साल याद नहीं हैं।`
    :variant===4?`${place}: ${landmark} ಬಳಿ ${fields.task} ಕೆಲಸ ಮಾಡಿದ್ದೆ. ಲಾಕ್‌ಡೌನ್‌ಗಿಂತ ಮುಂಚೆ; ನಿಖರವಾದ ವರ್ಷ ನೆನಪಿಲ್ಲ.`
    :`I did ${fields.task.toLowerCase()} at ${alias}, ${place}, ${landmark.toLowerCase()}. Period: ${time}.`;
  return {id:'fiction-'+number,owner:'fiction-'+number,outreach:variant!==3,person:{label:`Fictional ${names[n]} · ${number}`,fields,quote,version:1,location:{lat,lon,illustrative:true}}};
}));
export const fictionalSummary={workers:43,workplaceScenarios:10,places:['Bengaluru','Mysuru','Tumakuru','Jodhpur','Jaipur']};
