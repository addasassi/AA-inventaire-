// Télécharge la liste des communes de ZR Express (via le relais) → zr-communes.json
import { writeFileSync } from 'node:fs';
const r = await fetch('https://atelier-zr.mohammedsassiadda.workers.dev/?territories=1');
const j = await r.json();
if(!j.ok || !j.wilayas || !j.wilayas.length) throw new Error('réponse invalide: ' + JSON.stringify(j).slice(0, 300));
const n = Object.values(j.communes).reduce((t, l) => t + l.length, 0);
if(n < 1000) throw new Error('trop peu de communes: ' + n);
writeFileSync('zr-communes.json', JSON.stringify({updated: new Date().toISOString(), wilayas: j.wilayas, communes: j.communes}));
console.log(j.wilayas.length + ' wilayas, ' + n + ' communes');
