# 🎮 mmoRPGEduc - AI Agent Instructions

## 🧭 Princípios Fundamentais (NUNCA VIOLAR)

### Zero Trust Client

- ❌ NUNCA valide lógica de jogo no cliente (range, cooldown, dano, requisitos)
- ✅ Cliente APENAS envia intenções: `{ type: "ACTION", payload: {...} }`
- ✅ Cliente APENAS renderiza estado recebido do Firebase/worldEngine
- ✅ Cliente pode fazer "optimistic UI" mas DEVE reverter se server negar

### Server Authority (worldEngine)

- ✅ TODA validação de negócio ocorre no worldEngine (Node.js futuro)
- ✅ worldEngine é a ÚNICA fonte de verdade para: HP, dano, inventário, posição
- ✅ Firebase atua como "message bus" + persistência, NÃO como lógica

### Separação de Camadas

- ✅ worldEngine é "headless" - sem dependências de renderização ou cliente
- ✅ Cliente é "dumb" - sem lógica de jogo, apenas UI e input