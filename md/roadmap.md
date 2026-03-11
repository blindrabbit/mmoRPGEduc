markdown
# 🎓 mmoRPGEduc - Roadmap de Desenvolvimento Educacional

> **Visão do Projeto**: Criar um ecossistema onde **alunos criam desafios para outros alunos**, utilizando o núcleo do jogo para elaborar missões que integrem conteúdos do ensino médio (Biologia, Matemática, História, etc.) de forma engajadora e gamificada.

```yaml
Projeto: mmoRPGEduc
Stack: JavaScript (65.2%) + HTML (33.4%) + CSS (1.4%) + Firebase
Inspiração: Tibia (mecânicas clássicas de MMORPG)
Público-alvo: Alunos do Ensino Médio + Educadores
Status: 🟡 Fase Inicial (Primeiros commits - Mar/2026)

🗺️ Visão Geral do Roadmap
12
Timeline Estimada: 12-16 semanas para MVP educacional funcional
📋 FASE 0: Fundação Técnica (Semanas 1-2)
Objetivo: Estruturar o código para suportar mecânicas educacionais desde o início.
🔧 Infraestrutura & Código
markdown
- [ ] **Organizar estrutura de pastas**
  src/
  ├── core/           # Game loop, input, renderização
  ├── network/        # Firebase sync, protocolo de mensagens
  ├── entities/       # Player, NPC, Item, Quest
  ├── education/      # 🎓 Módulo educacional (novo!)
  │   ├── QuestionEngine.js
  │   ├── SubjectMapper.js
  │   └── RewardCalculator.js
  ├── ui/             # Componentes de interface
  └── utils/          # Helpers, math, crypto

- [ ] **Configurar ambiente de desenvolvimento**
  - [ ] ESLint + Prettier para padronização
  - [ ] Vite ou Webpack para bundling (opcional, mas recomendado)
  - [ ] Hot reload para desenvolvimento ágil

- [ ] **Definir schema de dados no Firebase**
  ```javascript
  // firestore.schema.js - Documentação do schema
  {
    players: {
      userId: {
        profile: { name, grade, schoolId },
        position: { mapId, x, y, timestamp },
        inventory: { itemId: quantity },
        progress: { subjectScores: { biology: 85, math: 72 } }
      }
    },
    quests: {
      questId: {
        title: "Coleta de Espécies Nativas",
        subject: "biology",
        gradeLevel: "1st_year_highschool",
        creatorId: "teacher_or_student",
        objectives: [
          { type: "collect", itemId: "plant_sample", quantity: 5 },
          { type: "quiz", questionId: "bio_001", minScore: 80 }
        ],
        rewards: { xp: 100, item: "herbarium_badge" }
      }
    },
    questions: {
      questionId: {
        subject: "biology",
        difficulty: "medium",
        text: "Qual organela é responsável pela fotossíntese?",
        options: [
          { id: "a", text: "Mitocôndria", correct: false },
          { id: "b", text: "Cloroplasto", correct: true }
        ],
        explanation: "O cloroplasto contém clorofila..."
      }
    }
  }

// firebase.rules.json - Segurança essencial
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{playerId} {
      allow read: if true;
      allow write: if request.auth.uid == playerId;
    }
    match /quests/{questId} {
      allow read: if true;
      allow create: if request.auth.uid != null;
      allow update, delete: if isCreatorOrTeacher(request.auth.uid, questId);
    }
    match /questions/{questionId} {
      allow read: if true;
      allow write: if isEducator(request.auth.uid);
    }
  }
}

Implementar Firebase Rules básicas
javascript
- [ ] **Organizar estrutura de pastas**
  src/
  ├── core/           # Game loop, input, renderização
  ├── network/        # Firebase sync, protocolo de mensagens
  ├── entities/       # Player, NPC, Item, Quest
  ├── education/      # 🎓 Módulo educacional (novo!)
  │   ├── QuestionEngine.js
  │   ├── SubjectMapper.js
  │   └── RewardCalculator.js
  ├── ui/             # Componentes de interface
  └── utils/          # Helpers, math, crypto

- [ ] **Configurar ambiente de desenvolvimento**
  - [ ] ESLint + Prettier para padronização
  - [ ] Vite ou Webpack para bundling (opcional, mas recomendado)
  - [ ] Hot reload para desenvolvimento ágil

- [ ] **Definir schema de dados no Firebase**
  ```javascript
  // firestore.schema.js - Documentação do schema
  {
    players: {
      userId: {
        profile: { name, grade, schoolId },
        position: { mapId, x, y, timestamp },
        inventory: { itemId: quantity },
        progress: { subjectScores: { biology: 85, math: 72 } }
      }
    },
    quests: {
      questId: {
        title: "Coleta de Espécies Nativas",
        subject: "biology",
        gradeLevel: "1st_year_highschool",
        creatorId: "teacher_or_student",
        objectives: [
          { type: "collect", itemId: "plant_sample", quantity: 5 },
          { type: "quiz", questionId: "bio_001", minScore: 80 }
        ],
        rewards: { xp: 100, item: "herbarium_badge" }
      }
    },
    questions: {
      questionId: {
        subject: "biology",
        difficulty: "medium",
        text: "Qual organela é responsável pela fotossíntese?",
        options: [
          { id: "a", text: "Mitocôndria", correct: false },
          { id: "b", text: "Cloroplasto", correct: true }
        ],
        explanation: "O cloroplasto contém clorofila..."
      }
    }
  }


### 🎮 Core Gameplay Mínimo
```markdown
- [ ] Player se move no mapa com interpolação de rede
- [ ] Outros players visíveis e sincronizados (limitado a área próxima)
- [ ] Sistema de colisão básico com tiles do mapa
- [ ] Chat local com filtro de palavras e rate limiting
- [ ] ✅ **Novo**: Sistema de "gatilhos educacionais" no movimento
  ```javascript
  // Exemplo: ao entrar em zona de biologia, dispara quiz opcional
  if (tile.tags.includes('biology_zone') && !player.completedQuiz) {
    EducationEngine.triggerOptionalQuiz('bio_intro_001');
  }


---

## 📚 FASE 1: Core Educacional (Semanas 3-5)
> **Objetivo**: Implementar as mecânicas que conectam gameplay com aprendizado.

### 🧠 Motor de Questões Integrado
```markdown
- [ ] **QuestionEngine.js** - Módulo central de perguntas
  ```javascript
  class QuestionEngine {
    // Tipos de interação suportados:
    // - quiz: múltipla escolha no chat/UI
    // - combat_answer: respostas afetam dano na batalha
    // - collection_puzzle: coletar itens baseado em conhecimento
    // - sequence_challenge: ordenar etapas de processo científico
    
    async presentQuestion(questionId, context) {
      // Renderiza UI de pergunta sem pausar o jogo completamente
      // Retorna promise com resultado e tempo de resposta
    }
    
    calculateOutcome(answer, question, playerStats) {
      // Lógica de recompensa baseada em:
      // - acerto/erro
      // - tempo de resposta
      // - histórico do aluno na matéria
      // - dificuldade ajustada dinamicamente
    }
  }

Sistema de Batalha Educacional ⚔️🧠
javascript
// Exemplo de mecânica: "Batalha de Conhecimento"
class EducationalCombat {
  // Inimigo tem "pontos de conceito" em vez de apenas HP
  // Cada ataque do jogador requer responder uma pergunta
  // Resposta correta = dano crítico + bônus de combo
  // Resposta errada = contra-ataque do inimigo
  
  onPlayerAttack(player, enemy, answer) {
    if (answer.isCorrect) {
      const damage = calculateBaseDamage(player) * 
                    (1 + answer.responseTimeBonus) *
                    (1 + player.subjectBonus[enemy.weaknessSubject]);
      enemy.takeDamage(damage);
      this.triggerFeedback('correct', answer.explanation);
    } else {
      enemy.counterAttack(player);
      this.triggerFeedback('incorrect', answer.correctExplanation);
    }
  }
}

Sistema de Coleta com Propósito 🌿
markdown
- [ ] Itens colecionáveis vinculados a conceitos educacionais
  - Ex: "Amostra de Folha" → requer identificar tipo de fotossíntese
  - Ex: "Fóssil" → requer datar era geológica correta
  
- [ ] Crafting educacional: combinar itens + conhecimento
  ```javascript
  // Receita: "Herbário Científico"
  {
    ingredients: [
      { item: "plant_sample", quantity: 3 },
      { item: "pressing_tool", quantity: 1 }
    ],
    knowledgeCheck: {
      subject: "biology",
      question: "Qual a função do xilema?",
      minScore: 70
    },
    result: {
      item: "herbarium_specimen",
      xp: { biology: 50 },
      unlock: "advanced_botany_zone"
    }
  }

1
📊 Progresso e Personalização
markdown
- [ ] **Perfil de Aprendizado do Aluno**
  - Rastrear desempenho por matéria (sem expor notas reais)
  - Sugerir quests baseadas em áreas que precisam de reforço
  - Badges visuais por conquistas educacionais

- [ ] **Sistema de Dificuldade Adaptativa**
  ```javascript
  // Ajusta perguntas baseado no histórico do jogador
  function getAdaptiveQuestion(playerId, subject, desiredDifficulty) {
    const playerHistory = getPlayerSubjectHistory(playerId, subject);
    const successRate = playerHistory.correctAnswers / playerHistory.total;
    
    // Se acertou >80% recentemente, aumenta dificuldade
    if (successRate > 0.8) {
      return fetchQuestion(subject, 'hard');
    } else if (successRate < 0.5) {
      return fetchQuestion(subject, 'easy').withHint(true);
    }
    return fetchQuestion(subject, desiredDifficulty);
  }


---

## ✏️ FASE 2: Editor de Missões para Alunos (Semanas 6-8)
> **Objetivo**: Permitir que alunos e professores criem quests sem programação.

### 🛠️ Interface de Criação No-Code
```markdown
- [ ] **Editor Visual de Quests** (em `admin.html` ou nova página)

[Criar Nova Missão]
│
├─ 📝 Informações Básicas
│ ├─ Título: ""
│ ├─ Matéria: [Dropdown: Biologia, Matemática, História...]
│ ├─ Série: [1º EM, 2º EM, 3º EM]
│ └─ Descrição: ""
│
├─ 🎯 Objetivos (arrastar e soltar)
│ ├─ [ + Adicionar Etapa ]
│ │ ├─ Tipo: [Coletar | Responder Quiz | Derrotar Inimigo | Puzzle]
│ │ ├─ Configurações específicas do tipo...
│ │ └─ Condição de conclusão: [Todos | Qualquer um]
│
├─ 🎁 Recompensas
│ ├─ XP por matéria: [Biology: __] [Math: __] ...
│ ├─ Itens: [Selecionar do catálogo]
│ └─ Desbloqueios: [Áreas, NPCs, Diálogos]
│
└─ 👥 Público-Alvo
├─ [ ] Disponibilizar para toda a escola
├─ [ ] Restringir a minha turma
└─ [ ] Modo "beta" (apenas convidados testam)



- [ ] **Biblioteca de Blocos Educacionais Reutilizáveis**
```javascript
// Exemplo de blocos pré-configurados para educadores
const EducationalBlocks = {
  quiz: {
    template: "single_choice",
    subjects: ["biology", "math", "history", "chemistry"],
    difficultyLevels: ["easy", "medium", "hard"],
    feedbackTypes: ["immediate", "after_quest", "none"]
  },
  collection: {
    itemCategories: ["flora", "fauna", "minerals", "artifacts"],
    validationMethods: ["visual_id", "property_match", "process_sequence"]
  },
  combat_edu: {
    mechanics: ["answer_to_attack", "combo_by_streak", "defense_by_knowledge"],
    enemyTypes: ["concept_guardian", "misconception_monster", "boss_final_exam"]
  }
};

Sistema de Revisão por Pares (para quests criadas por alunos)
markdown
- [ ] Quests de alunos entram em "fila de aprovação"
- [ ] Professores ou alunos avançados podem revisar
- [ ] Checklist de qualidade educacional:
  - [ ] Perguntas têm fontes/confiabilidade?
  - [ ] Dificuldade adequada para a série?
  - [ ] Recompensas balanceadas?
  - [ ] Sem viés ou conteúdo inadequado?
- [ ] Feedback construtivo para o criador

---

## 🌐 FASE 3: Ecossistema de Criação Colaborativa (Semanas 9-12)
> **Objetivo**: Transformar o jogo em uma plataforma viva de criação e compartilhamento.

### 🔄 Ciclo de Vida de Conteúdo Gerado por Usuários
```markdown
- [ ] **Sistema de Versões de Quests**
  ```javascript
  // Permitir que criadores atualizem quests sem quebrar progresso
  {
    questId: "bio_001",
    versions: [
      { v: "1.0", status: "deprecated", migration: "auto_update_to_1.1" },
      { v: "1.1", status: "active", createdAt: "2026-04-01" }
    ]
  }


Métricas de Engajamento Educacional
markdown
- [ ] Dashboard para criadores de quests:
  - Taxa de conclusão da missão
  - Tempo médio por etapa
  - Matérias com maior taxa de erro (oportunidade de melhoria)
  - Feedback qualitativo dos jogadores
  
- [ ] Sistema de "destaques" para quests bem avaliadas
  - Quests com alta completude + bom feedback ganham visibilidade
  - Ranking por matéria/série para estimular qualidade


Integração com Ferramentas Externas (opcional, mas poderoso)
markdown
- [ ] Exportar questões para formatos padrão (QTI, GIFT) para uso em LMS
- [ ] Importar questões de bancos educacionais abertos (Khan Academy, ENEM)
- [ ] Webhook para notificar professores quando aluno completa quest relevante

🎨 Personalização e Identidade
markdown
- [ ] **Sistema de Avatares e Customização**
  - Itens cosméticos desbloqueados por conquistas educacionais
  - Títulos especiais: "Mestre da Fotossíntese", "Explorador Histórico"
  
- [ ] **Espaços Pessoais/Clubes**
  - Alunos podem criar "clubes de estudo" com áreas personalizadas
  - Decoração do espaço baseada em conquistas coletivas da turma


🚀 FASE 4: Escala, Comunidade e Sustentabilidade (Semanas 13+)
Objetivo: Preparar o projeto para crescimento e uso em larga escala.
⚙️ Otimizações Técnicas Críticas
markdown
- [ ] **Performance de Rede**
  - [ ] Implementar "area of interest": só sincronizar players próximos
  - [ ] Compressão de mensagens com MessagePack (30-50% menor que JSON)
  - [ ] Cache local de quests e questões frequentemente acessadas

- [ ] **Backend Escalável**
  - [ ] Migrar lógica crítica para Cloud Functions (validação de respostas, cálculo de recompensas)
  - [ ] Implementar sharding de mapas por escola/região
  - [ ] Backup automático e exportação de dados para conformidade LGPD

- [ ] **Acessibilidade e Inclusão**
  - [ ] Suporte a leitores de tela para questões
  - [ ] Opções de daltonismo e alto contraste
  - [ ] Legendas e transcrições para conteúdos em áudio/vídeo

🌍 Expansão do Ecossistema
markdown
- [ ] **Programa de Embaixadores Estudantis**
  - Alunos avançados podem se tornar "moderadores" ou "criadores certificados"
  - Sistema de mentoria: alunos mais experientes ajudam novos criadores

- [ ] **Eventos Sazonais Educacionais**
  - "Semana da Ciência": quests especiais com temas de atualidades
  - "Olimpíada do Conhecimento": competições entre turmas/escolas

- [ ] **API Pública para Pesquisadores** (anonimizada e ética)
  - Permitir estudos sobre gamificação e aprendizagem
  - Dados agregados para melhorar o design educacional do jogo


🛠️ Ferramentas Recomendadas (Todas Gratuitas/Open Source)
Categoria
Ferramenta
Link
Por que usar
Engine Gráfica
Phaser 3
phaser.io
Leve, docs excelentes, perfeita para 2D estilo Tibia
Backend Alternativo
PocketBase
pocketbase.io
✅ Open-source, self-hosted, evita custos do Firebase
Editor de Mapas
Tiled
mapeditor.org
Padrão da indústria, exporta JSON fácil de integrar
UI/UX
Tailwind CSS + Alpine.js
tailwindcss.com
Leve, rápido, perfeito para interfaces dinâmicas
Testes
Jest + Cypress
jestjs.io
Garantir que mecânicas educacionais funcionem
Deploy
Cloudflare Pages + Railway
pages.cloudflare.com
Frontend gratuito + backend escalável com plano free
Analytics Educacional
PostHog
posthog.com
Rastrear engajamento sem violar privacidade, open-source
💡 Dica estratégica: Comece com Firebase para prototipagem rápida, mas planeje a migração para PocketBase quando o projeto crescer — assim você mantém o controle dos dados e evita surpresas com custos.
📅 Checklist de Primeiros Passos (Esta Semana)
markdown
## ✅ Imediato (Hoje/Amanhã)
- [ ] Criar arquivo `CONTRIBUTING.md` explicando como outros podem ajudar
- [ ] Adicionar `ROADMAP.md` (este arquivo!) ao repositório
- [ ] Configurar GitHub Issues com templates para:
  - [ ] 🐛 Bug Report
  - [ ] 🎓 Nova Quest/Educational Feature
  - - [ ] 💡 Sugestão de Melhoria

## 🎯 Esta Semana
- [ ] Definir schema inicial do Firebase (usar exemplo acima como base)
- [ ] Implementar sistema básico de movimento + sync de posição
- [ ] Criar módulo `EducationEngine.js` esqueleto com uma pergunta de teste
- [ ] Testar fluxo: player entra em zona → pergunta aparece → resposta afeta gameplay

## 📚 Para a Próxima Reunião
- [ ] Trazer 3 exemplos concretos de quests por matéria (Bio, Mat, Hist)
- [ ] Definir critérios mínimos de qualidade para quests criadas por alunos
- [ ] Esboçar wireframe do editor de missões no papel ou Figma

🎯 Métricas de Sucesso Educacional
javascript
// Como saber se o mmoRPGEduc está funcionando pedagogicamente?
const educationalSuccessMetrics = {
  engagement: {
    avgQuestCompletionRate: "> 70%",
    avgTimeOnEducationalContent: "> 3 min/quest",
    returnRate: "> 60% dos alunos voltam na semana seguinte"
  },
  learning: {
    knowledgeGain: "Pré/pós-teste mostra melhoria em conceitos abordados",
    transfer: "Alunos aplicam conhecimentos do jogo em avaliações tradicionais",
    curiosity: "Aumento em perguntas espontâneas sobre os temas"
  },
  creation: {
    studentCreatedQuests: "> 30% das quests ativas criadas por alunos",
    peerReviewQuality: "Quests revisadas têm taxa de aprovação > 80%",
    educatorAdoption: "Professores usam a plataforma sem treinamento extensivo"
  }
};


📝 Notas de Implementação Técnica
Prioridades de Código
Segurança primeiro: Todas as validações de resposta/progresso devem ocorrer no servidor/Firebase Rules
Performance de rede: Implementar "area of interest" cedo para evitar lag com muitos players
Modularidade: Separar claramente lógica de jogo, lógica educacional e infraestrutura de rede
Padrões de Código Recomendados
javascript
// ✅ Use módulos ES6 para organização
// education/QuestionEngine.js
export class QuestionEngine { ... }

// ✅ Use async/await para operações de rede
async function submitAnswer(questionId, answer) {
  try {
    const result = await firebase.firestore()
      .collection('questions')
      .doc(questionId)
      .get();
    return processAnswer(result.data(), answer);
  } catch (error) {
    console.error('Erro ao submeter resposta:', error);
    throw new Error('Falha na comunicação com o servidor');
  }
}

// ✅ Documente funções complexas com JSDoc
/**
 * Calcula dano em batalha educacional baseado em acerto e histórico
 * @param {Object} player - Dados do jogador
 * @param {Object} question - Dados da pergunta respondida
 * @param {boolean} isCorrect - Se a resposta estava correta
 * @returns {number} - Valor de dano calculado
 */
function calculateEducationalDamage(player, question, isCorrect) { ... }


🔗 Links Úteis
Repositório do Projeto
Documentação do Firebase
Phaser 3 Examples
BNCC - Base Nacional Comum Curricular
Gamificação na Educação - Referências
🚀 Próxima ação:
Salve este arquivo como md/ROADMAP.md no seu repositório
Escolha 3 itens da checklist "Imediato" para concluir nos próximos 2 dias
Compartilhe aqui o código de worldEngine.html ou src/ para ajuda técnica específica!
Última atualização: Março de 2026
Mantido por: Comunidade mmoRPGEduc ✨

---

## 📥 Como Salvar Este Arquivo

### Opção 1: Copiar e Colar (Recomendado)
1. **Selecione todo o conteúdo** entre as linhas horizontais acima
2. **Copie** (`Ctrl+C` ou `Cmd+C`)
3. No seu computador, crie um novo arquivo chamado `ROADMAP.md`
4. **Cole o conteúdo** e salve
5. Mova para a pasta `md/` do seu repositório

### Opção 2: Via Terminal/Git
```bash
# Navegue até a pasta do projeto
cd mmoRPGEduc

# Crie a pasta md se não existir
mkdir -p md

# Crie o arquivo e cole o conteúdo
nano md/ROADMAP.md

# Após colar, salve com Ctrl+O, Enter e saia com Ctrl+X

# Commit e push
git add md/ROADMAP.md
git commit -m "docs: adiciona roadmap educacional completo"
git push origin main