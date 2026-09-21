# TVmakina

Leitor de IPTV feito para **correr em PCs fracos** — o alvo de referência é
**Windows 7 SP1, 3 GB de RAM, Intel Core 2 Duo 2.20 GHz** — sem perder as
capacidades de um leitor completo: listas M3U/M3U8, HLS, multicast UDP da rede
local, ficheiros do próprio computador, sinais de teste e gravação.

É um projecto novo, independente do `Signal TV` que já existe neste repositório,
mas com o mesmo conjunto de funções. O que muda é a base técnica:

| | Signal TV (existente) | **TVmakina** |
|---|---|---|
| Interface | React 19 + Tailwind 4 + Vite 7 | **JavaScript ES5 puro**, sem frameworks |
| Motor | Electron 38 (Chromium 130+) | **Electron 22.3.27** (Chromium 108) |
| Windows mínimo | Windows 10 | **Windows 7 SP1** |
| Arquitectura | só x64 | **x64 e 32 bits (ia32)** |
| Precisa de compilar para usar | sim | **não** — há um HTML único que abre com duplo clique |
| Dependências | react, hls.js, mpegts.js, jszip, lucide… | **nenhuma** na aplicação; hls.js só como extra opcional |

---

## 1. A forma mais simples (não instala nada)

1. Copie **`dist/TVmakina-completo.html`** para o PC.
2. Duplo clique. Abre no browser.

| Ficheiro | Tamanho | Motor HLS |
|---|---|---|
| `dist/TVmakina.html` | 126 KB | não — toca HTTP/TS/MP4, multicast e sinais de teste |
| `dist/TVmakina-completo.html` | 532 KB | **sim** — toca também `.m3u8` |

Se a pasta `dist/` ainda não existir: `npm run build`, ou descarregue o
artefacto **TVmakina-browser** do GitHub Actions.

**Browser no Windows 7**

| Browser | Serve? |
|---|---|
| **Firefox 115 ESR** | Sim — recomendado |
| **Chrome / Chromium 109** | Sim (última versão para Windows 7) |
| Internet Explorer 11 | Abre a interface, mas **não tem MSE**: `.m3u8` não toca |

O TVmakina detecta um browser sem MSE e diz-lho em português, em vez de ficar
com o ecrã preto sem explicação.

---

## 2. Aplicação para desktop (EXE)

O EXE é o TVmakina com **Electron 22.3.27** — a última linha do Electron com
suporte a Windows 7 / 8 / 8.1 (o Chromium 109 deixou de suportar esses sistemas
e o Electron 23 seguiu-o; é por isso que o Signal TV, com Electron 38, não
arranca na sua máquina).

Gerados em `release/`:

```
TVmakina-Setup-1.0.0-x64.exe      instalador, Windows 64 bits
TVmakina-Setup-1.0.0-ia32.exe     instalador, Windows 32 bits
TVmakina-Portatil-1.0.0-x64.exe   portátil, não instala nada
TVmakina-Portatil-1.0.0-ia32.exe  portátil, 32 bits
```

Com 3 GB de RAM é muito provável que o seu Windows 7 seja de **32 bits** — nesse
caso use os `ia32`.

> **Sobre a compilação:** os EXE não podem ser gerados dentro deste ambiente de
> trabalho (o servidor que distribui o binário do Electron está bloqueado aqui).
> Use o GitHub Actions (secção 4) ou o `BUILD-WINDOWS.bat` num PC com Node.js.

---

## 3. Capacidades

**Listas e canais**
- M3U / M3U8 (`#EXTINF`, `tvg-id`, `tvg-logo`, `group-title`, `#EXTVLCOPT`)
- XSPF (VLC), JSON e texto simples (um URL por linha)
- Importar de **endereço web**, **ficheiro** ou **texto colado**
- Catálogos públicos incluídos em `channels/catalogo/` (PT, BR, AO, MZ, CV, ES, FR)
- Grupos, pesquisa sem acentos, favoritos, histórico, listas guardadas no PC

**Reprodução**
- HLS (`.m3u8`) com hls.js, afinado para pouca memória
- HTTP directo (`.ts`, `.mp4`, `.mkv`, …)
- **Multicast UDP** (`udp://@239.1.1.1:1234`) via proxy incluído
- Ficheiros locais (`file:///C:/Videos/…`)
- **Sinais de teste** gerados no próprio PC (SMPTE, barras, ruído, relógio) —
  funcionam sem rede e provam que o vídeo funciona naquela máquina
- Tenta de novo e, se falhar, passa ao canal seguinte

**Controlos**
- `Page Up/Down` canais · `0`-`9` sintonizar por número · `Espaço` pausa ·
  `M` silenciar · `F` favorito · `R` gravar · `I` informação · `/` procurar
- Volume, enquadramento (proporcional / preencher / esticar), limite de
  qualidade, janela flutuante (PiP), ecrã inteiro
- Barra de estado: resolução, débito, buffer, fotogramas perdidos, relógio

**Extras**
- **Gravação** do que está a ver (WebM, ou MP4 se o browser suportar)
- **Temporizador de sono** (15/30/60/90 min) — pára o stream e liberta memória
- Exportação de favoritos e listas em JSON

---

## 4. Como fica leve

| Decisão | Efeito |
|---|---|
| ES5 puro, sem React/Tailwind/transpilador | nada a correr em fundo; arranca em Chromium 108 e até IE11 |
| Lista **virtualizada** | 10 000 canais custam o mesmo que 30: só as linhas visíveis existem no DOM |
| `maxBufferSize` 2 MB (o hls.js usa 60 MB por omissão) | menos ~58 MB por canal |
| `enableWorker: false` | menos uma thread, menos trocas de contexto |
| Buffer 8–12 s em vez de 30 s | menos rede, menos memória |
| `capLevelToPlayerSize` + limite de ~720p no modo leve | um Core 2 Duo não descodifica 1080p por software |
| Heap do Chromium 256 MB, 2 processos de renderização, cache 50 MB | o Electron não come os 3 GB |
| GPU desligada por omissão no Windows 7 | drivers antigos deixam de dar ecrã preto |
| CSS sem `grid`/`gap`/variáveis CSS | funciona em browsers de 2015 |
| Detecção automática de máquina fraca | 2 núcleos ou ~3 GB ⇒ **modo leve** liga-se sozinho |

O modo leve também pode ser ligado/desligado num botão no canto superior direito.

---

## 5. Proxy UDP (canais multicast da rede local)

Um browser **não consegue** receber UDP. Por isso o TVmakina traz um proxy que
converte `udp://@239.1.1.1:1234` em `http://127.0.0.1:4022/udp/239.1.1.1:1234`.

```bash
node server/proxy.js                                  # porta 4022
node server/proxy.js --port 4023 --iface 192.168.1.20
```

| Rota | Para que serve |
|---|---|
| `/` | serve a própria página do TVmakina |
| `/udp/<grupo>:<porta>` | o fluxo MPEG-TS (compatível com **udpxy**) |
| `/status` | estado em JSON: clientes, bytes, sockets, interface |
| `/scan` | procura servidores de media na rede (SSDP) |
| `/proxy?url=…` | reencaminha um stream HTTP que o browser bloqueia (CORS, certificado, http em página https) |

Sem dependências externas. O Node 14 LTS corre em Windows 7 SP1.

---

## 6. Compilar

### Opção A — GitHub Actions (o seu PC não precisa de Node.js)

1. **Uma vez só:** copie `build/tvmakina-windows.yml` para
   `.github/workflows/tvmakina-windows.yml` e faça *commit*.
   (O ficheiro fica fora dessa pasta de propósito: o GitHub não deixa uma
   aplicação ligada por OAuth criar ficheiros em `.github/workflows/`.
   Detalhes em `build/LEIA-ME-workflow.txt`.)
2. Separador **Actions** → **Compilar TVmakina** → **Run workflow**.
3. Em **Artifacts**: `TVmakina-Windows7` (os EXE) e `TVmakina-browser` (os HTML).

### Opção B — num PC com Node.js

Duplo clique em `BUILD-WINDOWS.bat`, ou:

```bash
cd tvmakina
npm install --no-save electron@22.3.27 electron-builder@24.13.3 acorn jsdom
npm run verify          # ES5 + testes + ficheiro único
npm run dist:win        # instalador e portátil, x64 e ia32
```

---

## 7. Verificação

```bash
npm run check    # confirma que a aplicação continua em ES5 (Chromium 108 / IE11)
npm test         # 56 testes
npm run build    # gera dist/TVmakina.html e dist/TVmakina-completo.html
npm run verify   # os três
```

Os testes correm o **código real**, não uma cópia: carregam o `index.html` num
DOM e exercitam a interface; abrem o `server/proxy.js` e enviam-lhe datagramas
UDP verdadeiros; verificam as flags e limites do Electron para 3 GB / 2 núcleos;
e voltam a arrancar num DOM o ficheiro único acabado de gerar.

---

## 8. Estrutura

```
tvmakina/
├── index.html              interface (página única)
├── app/                    aplicação em ES5
│   ├── core.js             utilitários, tipos de stream, URLs do proxy
│   ├── parser.js           M3U / XSPF / JSON / texto, grupos, filtros
│   ├── store.js            localStorage com reserva em memória
│   ├── net.js              fetch com reserva em XMLHttpRequest
│   ├── lowend.js           detecção e ajustes para PCs fracos
│   ├── player.js           vídeo + HLS + sinais de teste + gravador
│   ├── ui.js               interface e lista virtualizada
│   └── main.js             arranque
├── styles/tvmakina.css     CSS compatível com IE11
├── vendor/hls.min.js       motor HLS (ES5, opcional)
├── server/proxy.js         proxy UDP→HTTP + servidor da página
├── electron.cjs            processo principal do Electron
├── electron/config.cjs     ajustes para PC fraco (testáveis sem Electron)
├── electron/preload.cjs    ponte segura (contextIsolation + sandbox)
├── channels/               lista de arranque + catálogos públicos
├── build/                  ficheiro único, ícones, verificação ES5
├── test/                   56 testes (node --test)
├── docs/Windows7-Guia.md   guia completo em português
└── dist/                   (gerado) os dois HTML únicos
```

---

## 9. Avisos

- O TVmakina **não inclui canais pagos** nem contorna protecções. Os catálogos
  em `channels/catalogo/` vêm do projecto público
  [iptv-org](https://github.com/iptv-org/iptv) e **não foram testados** a partir
  da máquina de compilação: um canal pode estar offline ou geo-bloqueado.
- Importe apenas listas que tem autorização para usar.
- O Windows 7 está sem suporte da Microsoft desde Janeiro de 2020 e o
  Chromium 108 deixou de receber correcções em Outubro de 2023. Para ver
  televisão na rede local é aceitável; para navegar na internet, não.

Guia passo a passo: [`docs/Windows7-Guia.md`](docs/Windows7-Guia.md)
