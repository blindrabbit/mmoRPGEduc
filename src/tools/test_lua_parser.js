// Teste rápido do parser Lua
import fs from 'fs';

const luaContent = fs.readFileSync('G:\\Meu Drive\\SEDU\\2026\\RPG_Novo\\canary\\data-canary\\monster\\mammals\\wolf.lua', 'utf-8');

// Testar regex
const nameMatch = luaContent.match(/Game\.createMonsterType\(["']([^"']+)["']\)/);
console.log('Name match:', nameMatch);

const corpseMatch = luaContent.match(/monster\.corpse\s*=\s*(\d+)/);
console.log('Corpse match:', corpseMatch);

const voiceRegex = /text\s*=\s*["']([^"']+)["']/g;
let voiceMatch;
const voices = [];
while ((voiceMatch = voiceRegex.exec(luaContent)) !== null) {
  voices.push(voiceMatch[1]);
}
console.log('Voices:', voices);
