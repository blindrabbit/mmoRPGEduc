# 🐉 Dados de Monstros do Canary — Status

## 📊 Situação Atual

**Caminho do Canary:**
```
G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster\
```

**Status:** ⚠️ **Vazio** — Arquivos XML dos monstros não encontrados

---

## 🔍 O Que Acontece

### Quando os Dados Existem

Se existirem arquivos como `wolf.xml`, `rotworm.xml`, etc.:

```bash
node src/tools/monsterExtractor.js assets/mapa-monster.xml
```

**Saída:**
```
📖 Canary: G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster
✅ Dados Canary: 3 monstros
📁 assets/data_monster.json (com falas, loot, corpse IDs)
```

---

### Quando os Dados Não Existem (Atual)

```bash
node src/tools/monsterExtractor.js assets/mapa-monster.xml
```

**Saída:**
```
📖 Canary: G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster
✅ Dados Canary: 0 monstros
📁 assets/monster_catalog.json (com dados padrão)
```

**O script usa dados padrão:**
- HP: 100
- Ataques: Melee básico
- Sem falas
- Sem loot
- Corpse: IDs genéricos

---

## 📁 Estrutura Esperada do Canary

```
canary/data-canary/monster/
├── wolf.xml
├── rotworm.xml
├── dragon.xml
├── orc.xml
└── ...
```

---

## 📄 Exemplo de XML (wolf.xml)

```xml
<?xml version="1.0"?>
<monster name="Wolf" nameDescription="a wolf" race="blood" experience="20" speed="200" manacost="0">
  <health now="60" max="60" />
  <look type="305" corpse="2660" />
  <flags>
    <flag attackable="1" />
    <flag hostile="1" />
    <flag walk="random" />
  </flags>
  <voices>
    <voice event="script" sentence="Groooowl!" interval="3000" />
    <voice sentence="Yip!" interval="2000" />
  </voices>
  <attacks>
    <attack name="melee" damage="0-10" interval="1500" />
  </attacks>
  <loot>
    <item id="2666" countmax="2" chance="30000" />
    <item id="2671" countmax="1" chance="50000" />
  </loot>
  <elements>
    <element firePercent="-10" />
    <element icePercent="20" />
  </elements>
  <immunities>
    <immunity name="fire" />
    <immunity name="energy" />
  </immunities>
</monster>
```

---

## 🔧 Como Obter os Arquivos

### Opção 1: Copiar do Canary Original

Se você tem o repositório Canary completo:

```bash
# Copiar do repositório original
xcopy "C:\path\to\canary\data-canary\monster\*.xml" "G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster\" /Y
```

---

### Opção 2: Criar Manualmente

Criar arquivos XML básicos:

**wolf.xml:**
```xml
<?xml version="1.0"?>
<monster name="Wolf">
  <health now="60" max="60" />
  <look type="305" corpse="2660" />
  <voices>
    <voice sentence="Groooowl!" interval="3000" />
  </voices>
  <attacks>
    <attack name="melee" damage="10" interval="1500" />
  </attacks>
  <loot>
    <item id="2666" countmax="2" chance="30000" />
  </loot>
</monster>
```

---

### Opção 3: Usar Dados Padrão (Atual)

O script já funciona sem os dados do Canary, usando valores padrão.

**Vantagens:**
- ✅ Funciona imediatamente
- ✅ Não depende de arquivos externos
- ✅ Fácil de personalizar

**Desvantagens:**
- ❌ Sem falas dos monstros
- ❌ Sem loot detalhado
- ❌ Sem resistências/elementos
- ❌ Corpse IDs genéricos

---

## 📊 Comparação

| Recurso | Com Canary | Sem Canary (Atual) |
|---------|------------|-------------------|
| **HP/Stats** | ✅ Extraído | ✅ Padrão |
| **Falas** | ✅ Extraído | ❌ Vazio |
| **Loot** | ✅ Extraído | ❌ Vazio |
| **Elementos** | ✅ Extraído | ❌ Vazio |
| **Imunidades** | ✅ Extraído | ❌ Vazio |
| **Corpse ID** | ✅ Extraído | ✅ Mapeado |
| **Ataques** | ✅ Extraído | ✅ Padrão |

---

## 🎯 Próximos Passos

### 1. Verificar se Canary Está Completo

```bash
# Verificar arquivos no Canary
dir "G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster\*.xml"
```

Se estiver vazio, precisa copiar os arquivos.

---

### 2. Copiar Arquivos (Se Necessário)

```bash
# Do repositório Canary original
copy "C:\canary\data-canary\monster\*.xml" "G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster\"
```

---

### 3. Testar Extração

```bash
node src/tools/monsterExtractor.js assets/mapa-monster.xml
```

**Saída esperada (com dados):**
```
✅ Dados Canary: 50+ monstros
📁 assets/data_monster.json
```

---

## 📝 Notas

### Nomes de Arquivo

Os arquivos devem seguir o padrão:
- `wolf.xml` (não `Wolf.xml`)
- `rotworm.xml`
- `dragon_lord.xml` (usar underscore para espaços)

### Encoding

Usar **UTF-8** para evitar problemas com caracteres especiais.

---

## 📞 Suporte

Se os arquivos existirem mas não forem detectados:

1. **Verificar encoding:**
   ```bash
   file "G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster\wolf.xml"
   ```

2. **Verificar permissões:**
   ```bash
   icacls "G:\Meu Drive\SEDU\2026\RPG_Novo\canary\data-canary\monster"
   ```

3. **Testar manualmente:**
   ```javascript
   const fs = require('fs');
   const path = 'G:/Meu Drive/SEDU/2026/RPG_Novo/canary/data-canary/monster/wolf.xml';
   console.log(fs.existsSync(path));
   ```

---

**Status:** ⚠️ **Aguardando arquivos XML do Canary**  
**Script:** ✅ **Funcional e pronto para uso**  
**Última atualização:** 2026-03-29
