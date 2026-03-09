# Regras de Segurança — Firebase Realtime Database

Arquivo de regras criado em [firebase.rules.json](firebase.rules.json).

## Objetivo

Aplicar validação no servidor para as escritas críticas do jogo:

- `online_players`
- `players_data`
- `world_entities`
- `world_effects`
- `world_fields`

Isso complementa (não substitui) a validação client-side em `core/db.js`.

## O que já está validado nas rules

- Faixa de coordenadas (`x`, `y`) e andar (`z`)
- Direções permitidas (`frente`, `costas`, `lado`, `lado-esquerdo`)
- Faixas de HP/MP e stats principais
- Durações, timestamps e `tickRate`
- IDs de efeito/campo (`effectId`, `fieldId`)

## Como aplicar

1. Abra o Firebase Console → Realtime Database → Rules.
2. Copie o conteúdo de [firebase.rules.json](firebase.rules.json).
3. Publique as regras.

## Observação importante

As regras atuais mantêm leitura/escrita abertas em alguns nós administrativos (`accounts`, `world_tiles`, `monster_templates`, etc.) para não quebrar o fluxo atual do projeto experimental.

Para endurecimento estilo MMORPG, o próximo passo é:

- autenticação real por sessão/usuário (Firebase Auth);
- permissões por dono de personagem;
- backend autoritativo para combate/movimento (Cloud Functions ou servidor dedicado).
