# 🎮 Panorama & Análise — mmoRPGGame Educacional

> Projeto: Game estilo Tibia em JavaScript + Firebase para gamificação educacional

---

## 1. Visão Geral da Arquitetura

O sistema é um **MMO-RPG 2D top-down** inspirado no Tibia, rodando 100% no navegador com Firebase Realtime Database como backend. A arquitetura é bem organizada em camadas, com separação clara de responsabilidades:

```
rpg.html / worldEngine.html / playerManager.html
        ↓ (interface + bootstrap)
 ┌──────────────────────────────────────────────────┐
 │  gameplay/         — motor do jogo               │
 │    gameCore.js     — orquestra render + combate  │
 │    combatEngine.js — aplica dano, morte, respawn │
 │    combatLogic.js  — cálculos PUROS de combate   │
 │    monsterAI.js    — IA PURA dos monstros        │
 │    monsterManager.js — loop de IA + Firebase     │
 │    playerManager.js  — ciclo de vida do player   │
 │    input.js / inputController.js — teclado       │
 │    eventLog.js     — log de eventos in-game      │
 └──────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────────┐
 │  core/             — fundação do sistema         │
 │    config.js       — ÚNICA fonte de constantes   │
 │    schema.js       — estrutura canônica Firebase │
 │    db.js           — único ponto de acesso ao DB │
 │    firebaseClient.js — primitivas Firebase       │
 │    worldStore.js   — estado local em memória     │
 │    collision.js    — detecção de colisão         │
 │    remoteTemplates.js — cache de templates       │
 └──────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────────┐
 │  render/           — pipeline visual             │
 │    mapRenderer.js  — renderiza tiles do mapa     │
 │    worldRenderer.js — render completo da cena    │
 │    animationController.js — animações de sprite  │
 │    assetLoader.js / assetManager.js — sprites    │
 │    outfitData.js   — mapeamento de outfits       │
 └──────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────────┐
 │  admin/            — ferramentas de GM           │
 │    actions.js      — ações administrativas       │
 │    adminLoader.js  — bootstrap do painel admin   │
 └──────────────────────────────────────────────────┘
```

### Telas do Sistema

| Arquivo              | Papel                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| `rpg.html`           | Cliente do jogador — joga o game                                                  |
| `worldEngine.html`   | Servidor / GM — painel administrativo unificado (entidades, monstros, mapa, chat) |
| `admin.html`         | Legado/inativo — mantido apenas para referência histórica                         |
| `playerManager.html` | Painel de gestão de personagens                                                   |

---

## 2. Funcionamento do Núcleo

### 2.1 Dados no Firebase

O banco usa 5 nós principais no Realtime Database:

| Nó               | Conteúdo                                                  |
| ---------------- | --------------------------------------------------------- |
| `players_data`   | Dados persistentes dos personagens (stats, posição, nome) |
| `online_players` | Snapshot de sessão — posição e estado em tempo real       |
| `world_entities` | Monstros ativos no mapa                                   |
| `world_effects`  | Efeitos visuais temporários (magias, impactos)            |
| `world_fields`   | Campos de dano persistentes (fogo, veneno)                |

### 2.2 Ciclo de Jogo

1. **Boot**: `rpg.html` carrega assets (mapa JSON, atlas de sprites), conecta ao Firebase e puxa os dados do personagem autenticado (por email em Base64).
2. **Loop de render**: requestAnimationFrame processa movimento interpolado, renderiza mapa (tiles em Z-layers), entidades, efeitos e HUD.
3. **Input**: `inputController.js` captura teclado, valida colisão via `collision.js` e sincroniza posição para o Firebase via `playerManager.js`.
4. **Combate**: O clique em monstro dispara `combatEngine.js`, que usa `combatLogic.js` (cálculos puros) para determinar dano, aplica ao Firebase e gera efeitos visuais.
5. **IA dos Monstros**: `worldEngine.html` roda o loop de IA (`monsterManager.js` + `monsterAI.js`) e sincroniza os monstros no Firebase para todos os clientes.

### 2.3 Sistema de Combate

A fórmula é equilibrada e documentada em `combatLogic.js`:

- **Chance de acerto base**: 80% + bônus de AGI do atacante − esquiva do defensor
- **Dano**: escalado por ATK, reduzido por DEF (cap de 75%), com bônus por level
- **Cooldown**: 1000ms entre ataques do player
- **IA**: cada monstro decide mover/atacar a cada 300ms (configurável)

### 2.4 Classes de Personagem

Quatro classes com atributos distintos: `cavaleiro`, `mago`, `arqueiro`, `clerigo` — todas em `config.js`, fácil de adicionar novas.

### 2.5 Mapa Multi-andar

O sistema suporta múltiplos andares (floors/Z-layers), com renderização de teto dinâmica (fade radius) e o jogador sempre no `GROUND_Z = 7`.

---

## 3. Pontos Fortes do Projeto ✅

1. **Separação limpa de responsabilidades**: `combatLogic.js` e `monsterAI.js` são ZERO-dependency (sem Firebase, sem DOM), facilmente testáveis e extensíveis.

2. **Schema centralizado**: Todo objeto que entra ou sai do Firebase passa pelo `schema.js` — garante consistência e permite migração de dados (`schema_migration.md` já documenta o processo).

3. **Fonte única de verdade**: `config.js` concentra TODAS as constantes. Balancear o jogo é editar um único arquivo.

4. **`worldStore.js` como cache local**: Estado do mundo fica em memória, evitando leituras excessivas ao Firebase a cada frame.

5. **Aliases de compatibilidade** em `config.js`: nomes antigos mantidos como `@deprecated`, permitindo refatoração gradual sem quebrar o código todo de uma vez.

6. **Suporte a multi-piso e multi-cliente**: Arquitetura pensa no multiplayer desde o início.

---

## 4. Sugestões de Melhoria

### 🔴 Prioridade Alta

#### 4.1 Sistema de NPCs e Diálogos (fundamental para educação)

Atualmente não existe NPC interativo. Para metodologias ativas, você precisará de personagens que entreguem missões, expliquem conteúdo e validem respostas dos alunos.

**Sugestão de implementação:**

```javascript
// core/schema.js — adicionar makeNPC()
export function makeNPC({ id, name, x, y, z, dialogTree, questId }) {
  return { id, name, x, y, z, type: "npc", dialogTree, questId };
}

// Firebase nó: world_npcs
// gameplay/npcManager.js — gerencia interações
// gameplay/dialogEngine.js — processa árvores de diálogo
```

O `dialogTree` pode conter perguntas educacionais com múltipla escolha, validadas localmente antes de liberar a próxima etapa da missão.

#### 4.2 Sistema de Quests / Missões Educacionais

O núcleo do jogo não tem sistema de quests. Esse é o coração da gamificação educacional.

**Estrutura sugerida:**

```javascript
// Firebase: quests_data (templates) + players_data/{id}/quests (progresso)
const questTemplate = {
  id: "mat_fractions_01",
  title: "Frações no Mercado",
  subject: "matemática",
  steps: [
    { type: "talk_npc", npcId: "merchant_01", trigger: "start" },
    { type: "answer_question", questionId: "q_fractions_01" },
    { type: "deliver_item", itemId: "apple", quantity: 3 },
    { type: "reach_tile", x: 110, y: 95 },
  ],
  rewards: { xp: 100, skill: "matematica", skillPoints: 5 },
};
```

#### 4.3 Integração com Planilhas (Google Sheets → Firebase)

Como você mencionou querer sincronizar notas e frequência com os personagens, é crucial criar um pipeline claro.

**Fluxo sugerido:**

```
Google Sheets (avaliações/frequência)
    ↓ Google Apps Script (webhook ou trigger)
    ↓ Cloud Function Firebase (valida + processa)
    ↓ players_data/{id}/stats (atualiza HP, ATK, skills)
    ↓ rpg.html percebe mudança via dbWatch e atualiza o personagem
```

Isso permite que a nota de uma prova se converta automaticamente em XP, skills ou HP extra — o professor não precisa entrar no game para distribuir recompensas.

---

### 🟡 Prioridade Média

#### 4.4 Sistema de Inventário e Itens

Sem inventário, não há como distribuir "itens de missão" ou recompensas tangíveis. Um inventário simples seria suficiente para começar:

```javascript
// players_data/{id}/inventory: { [itemId]: quantidade }
// assets/items_data.json: catálogo de itens com sprite e descrição
```

#### 4.5 Habilidades e Skills Educacionais

Criar um sistema de skills ligadas às disciplinas do currículo — em vez de "Magia de Fogo", o aluno desbloqueia "Raciocínio Lógico" ou "Escrita Criativa" ao atingir notas/frequência mínimas.

```javascript
// core/config.js — adicionar SKILL_TREE
export const SKILL_TREE = {
  matematica: { icon: "📐", stat: "atk", bonusPerPoint: 1.5 },
  portugues: { icon: "📖", stat: "mp", bonusPerPoint: 2.0 },
  ciencias: { icon: "🔬", stat: "agi", bonusPerPoint: 1.2 },
  historia: { icon: "📜", stat: "def", bonusPerPoint: 1.8 },
};
```

#### 4.6 Painel do Professor (substituto do admin.html atual)

O `admin.html` atual é um editor de mapa técnico. Para uso educacional, considere criar um **painel pedagógico separado** com:

- Visualização de todos os personagens e seus stats em tempo real
- Distribuição manual de XP / recompensas por turma
- Ativação de eventos in-game (boss de revisão, evento especial)
- Relatório de quests completadas por aluno

#### 4.7 Sistema de Log de Ações Pedagógicas

Registrar no Firebase as ações educacionalmente relevantes dos alunos (quest completada, resposta correta, quest falhada), para permitir análise posterior pelo professor.

```javascript
// Firebase: pedagogy_log/{studentId}/{timestamp}
{ questId, action: 'completed', score: 9.0, timestamp }
```

---

### 🟢 Prioridade Baixa / Refinamentos Técnicos

#### 4.8 Sistema de Persistência de Sessão Melhorado

Atualmente o ID do jogador é o email em Base64, o que é funcional mas frágil. Considere integrar o **Firebase Authentication** diretamente, usando o UID do Google como ID do personagem — elimina a codificação manual e adiciona segurança.

#### 4.9 Testes Automatizados

Os módulos `combatLogic.js` e `monsterAI.js` já são puros (zero dependências). São candidatos perfeitos para testes unitários com Vitest ou Jest, garantindo que mudanças de balanceamento não quebrem mecânicas existentes.

#### 4.10 Hot-reload de Quests e Mapas por Módulo

Para atender seu objetivo de adicionar novos desafios via scripts externos, formalize um sistema de carregamento dinâmico:

```javascript
// Carregar módulo de desafio de URL externa
const module = await import(`/challenges/mat_algebra_01/quest.js`);
module.register(questEngine, npcManager);
```

Isso permite criar novos desafios em arquivos separados, sem tocar no núcleo do jogo.

#### 4.11 Resolver as Duplicidades Documentadas

O próprio `schema_migration.md` já identificou que `defaultSpeed` está duplicado entre `config.js` e `schema.js`. Resolver isso evita bugs futuros onde ajustar em um lugar não reflete no outro.

---

## 5. Roadmap Sugerido

```
FASE 1 — Núcleo Pedagógico (2-4 semanas)
├── NPCs com diálogos simples
├── Sistema de quests (estrutura de steps)
└── Primeiro desafio educacional funcional (ex: quiz in-game)

FASE 2 — Integração Escolar (2-3 semanas)
├── Pipeline Google Sheets → Firebase
├── Skills educacionais ligadas a disciplinas
└── Painel do professor (básico)

FASE 3 — Expansão de Conteúdo
├── Sistema de inventário e itens de missão
├── Novos mapas e desafios por módulo carregável
└── Log pedagógico e relatórios

FASE 4 — Polimento e Escalabilidade
├── Firebase Auth integrado
├── Testes automatizados dos módulos puros
└── Documentação de API para criação de novos desafios
```

---

## 6. Conclusão

O projeto tem uma **base técnica sólida e bem estruturada** para o objetivo proposto. A separação em camadas, o schema centralizado e a arquitetura orientada ao Firebase são escolhas acertadas para um MMO escolar. Os maiores gaps hoje estão no **camada de conteúdo educacional** — que é natural para um núcleo em desenvolvimento — e não em problemas estruturais do código.

O caminho mais estratégico é implementar NPCs + Quests primeiro, pois esses são os vetores pelos quais toda a gamificação educacional vai fluir. Com esses dois sistemas no lugar, adicionar novos desafios torna-se uma questão de configuração e conteúdo, não de programação do núcleo.
