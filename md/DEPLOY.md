# ═══════════════════════════════════════════════════════════════
# Scripts de Deploy — mmoRPGGame
# ═══════════════════════════════════════════════════════════════

## 📁 Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `deploy-firebase-rules.bat` | Script Windows (CMD) |
| `deploy-firebase-rules.ps1` | Script Windows (PowerShell) |
| `firebase.json` | Configuração do Firebase |
| `.firebaserc` | Projeto Firebase |
| `md/firebase.rules.json` | Regras do banco de dados |

---

## 🚀 Uso Rápido

### Opção 1: PowerShell (Recomendado)

```powershell
# Apenas validar
.\deploy-firebase-rules.ps1 -ValidateOnly

# Fazer deploy completo
.\deploy-firebase-rules.ps1
```

### Opção 2: CMD

```cmd
deploy-firebase-rules.bat
```

### Opção 3: Firebase CLI Direto

```bash
# Validar regras
firebase database:rules:check md/firebase.rules.json

# Fazer deploy
firebase deploy --only database:rules
```

---

## 📋 Pré-requisitos

### 1. Node.js e npm

```bash
# Verificar se está instalado
node --version
npm --version
```

Se não tiver, instale em: https://nodejs.org/

### 2. Firebase CLI

```bash
npm install -g firebase-tools

# Verificar instalação
firebase --version
```

### 3. Login no Firebase

```bash
firebase login
```

### 4. Selecionar Projeto

```bash
# Listar projetos
firebase projects:list

# Selecionar projeto
firebase use <project-id>

# Ou adicionar novo projeto
firebase use --add
```

---

## 🔧 Configuração Inicial

### Passo 1: Editar `.firebaserc`

Abra o arquivo `.firebaserc` e substitua `SEU_PROJETO_AQUI` pelo ID do seu projeto Firebase:

```json
{
  "projects": {
    "default": "meu-projeto-rpg"
  }
}
```

### Passo 2: Verificar `firebase.json`

O arquivo `firebase.json` já está configurado corretamente:

```json
{
  "database": {
    "rules": "md/firebase.rules.json"
  }
}
```

Isso aponta para as regras em `md/firebase.rules.json`.

---

## 🧪 Testar com Emulator (Opcional)

### Iniciar Emuladores

```bash
firebase emulators:start
```

Acesse: http://localhost:4000

### Testar Regras

Na UI do emulador, você pode simular leituras/escritas e ver se as regras estão funcionando.

---

## 📊 Verificar Regras em Produção

### Via CLI

```bash
# Baixar regras atuais
firebase database:rules:get

# Ou salvar em arquivo
firebase database:rules:get regras-atuais.json
```

### Via Console

1. Acesse https://console.firebase.google.com/
2. Selecione seu projeto
3. Build → Realtime Database → Rules

---

## ⚠️ Solução de Problemas

### Erro: "Firebase CLI not installed"

```bash
npm install -g firebase-tools
```

### Erro: "Not logged in"

```bash
firebase login
```

### Erro: "No project found"

```bash
firebase use --add
```

### Erro: "Rules validation failed"

1. Verifique a sintaxe do JSON em `md/firebase.rules.json`
2. Use um validador de JSON: https://jsonlint.com/
3. Execute: `firebase database:rules:check md/firebase.rules.json`

### Erro: "Permission denied"

Verifique se você tem permissão de editor/admin no projeto Firebase.

---

## 📁 Estrutura de Arquivos

```
g:\Meu Drive\SEDU\2026\RPG_Novo\
├── firebase.json              # Configuração do Firebase
├── .firebaserc                # Projeto Firebase
├── deploy-firebase-rules.bat  # Script CMD
├── deploy-firebase-rules.ps1  # Script PowerShell
├── md/
│   └── firebase.rules.json    # ✅ Regras do banco de dados
└── ...
```

---

## 🔐 Regras Aplicadas

As regras em `md/firebase.rules.json` incluem:

- ✅ Validação de tipos de ação (lista branca)
- ✅ Validação de timestamps (anti-replay)
- ✅ Validação de coordenadas (anti-teleporte)
- ✅ Validação de velocidade (anti-speed-hack)
- ✅ Bloqueio de campos administrativos
- ✅ Validação de itens do mapa (anti-duplicação)

Veja `FIREBASE_RULES.md` para detalhes completos.

---

## 📞 Suporte

Para mais informações:

- [Firebase Documentation](https://firebase.google.com/docs)
- [Realtime Database Rules](https://firebase.google.com/docs/database/security)
- [Firebase CLI Reference](https://firebase.google.com/docs/cli)

---

**Última atualização:** 2026-03-29
