# Guia do TVmakina para Windows 7 (3 GB de RAM, Core 2 Duo 2.20 GHz)

Guia em português, do princípio ao fim.

---

## 0. Preparar o Windows 7 (faça isto primeiro)

O motor por detrás do EXE (Chromium 108) só arranca num Windows 7 **SP1** com
algumas actualizações. Sem elas, o EXE pode nem abrir.

1. `Iniciar` → `Painel de Controlo` → `Sistema`: confirme **Service Pack 1**.
2. Instale pelo Windows Update (ou pelo Catálogo da Microsoft):
   - **KB4474419** — suporte a assinaturas SHA-2. Sem isto, o Windows 7 nem
     consegue instalar programas assinados com SHA-2 (todos os actuais).
   - **KB4490628** (ou SSU mais recente) — actualização da pilha de actualização.
   - **KB2533623** — por vezes pedida por bibliotecas do Chromium.
3. Reinicie.
4. Ainda em `Sistema`, veja a linha **Tipo de sistema**: **32 bits** ou
   **64 bits**. Com 3 GB de RAM é quase sempre **32 bits** — e é isso que decide
   qual EXE deve usar.

---

## 1. Caminho A — ficheiro único (o mais leve; comece por aqui)

Não instala nada, não precisa de Node.js, e é o que menos memória gasta.

1. Copie **`dist/TVmakina-completo.html`** para o PC (pen USB, rede, email…).
2. Arraste o ficheiro para a janela do browser, ou duplo clique.
3. Botão **Importar canais** → escolha um catálogo em *Exemplos incluídos*, ou
   indique o endereço/ficheiro da sua lista.

| Ficheiro | Tamanho | Motor HLS |
|---|---|---|
| `dist/TVmakina.html` | 126 KB | não — só HTTP directo, multicast e testes |
| `dist/TVmakina-completo.html` | 532 KB | **sim** — toca também `.m3u8` |

### Que browser usar no Windows 7

| Browser | Serve? |
|---|---|
| **Firefox 115 ESR** | Sim — recomendado |
| **Chrome / Chromium 109** | Sim — foi a última versão para Windows 7/8/8.1 |
| Internet Explorer 11 | Abre a interface, mas **não tem MSE**: `.m3u8` não toca |

Notas:
- O Chrome 110 e seguintes já exigem Windows 10. Não actualize além do 109.
- O Chromium exige um processador com **SSE3**. O Core 2 Duo tem SSE3, mas
  alguns modelos muito antigos (merom primitivos) não — se o browser nem abrir,
  é isso.
- **Abrir sempre com o Firefox:** botão direito no ficheiro → `Abrir com` →
  `Escolher programa predefinido` → Firefox → marcar *Utilizar sempre este
  programa*.

---

## 2. Caminho B — EXE (aplicação instalada)

O EXE traz o próprio motor, por isso não depende do browser instalado.

### 2.1 Obter o EXE

Os EXE são compilados nos servidores do GitHub; o seu PC não precisa de Node.js.

1. **Uma vez só:** copie `tvmakina/build/tvmakina-windows.yml` para
   `.github/workflows/tvmakina-windows.yml` no repositório e faça *commit*
   (o GitHub não deixa uma aplicação OAuth criar ficheiros nessa pasta;
   instruções em `tvmakina/build/LEIA-ME-workflow.txt`).
2. GitHub → separador **Actions** → **Compilar TVmakina** → **Run workflow**.
3. No fim, em **Artifacts**, descarregue **TVmakina-Windows7**.
4. Descompacte o ZIP.

### 2.2 Qual ficheiro usar

| O seu Windows | Use |
|---|---|
| 64 bits, quer instalar | `TVmakina-Setup-1.0.0-x64.exe` |
| **32 bits** (típico com 3 GB) | `TVmakina-Setup-1.0.0-ia32.exe` |
| Não quer instalar nada | `TVmakina-Portatil-1.0.0-ia32.exe` (ou `-x64`) |

O Windows pode avisar que o editor é desconhecido: o programa não está assinado
digitalmente. Escolha **Executar**.

A versão portátil não escreve no registo — pode andar numa pen USB.

### 2.3 Se a janela abrir preta, ou não abrir

A culpa é quase sempre do driver gráfico antigo. O TVmakina **já desliga a GPU
por omissão no Windows 7**, mas se ainda assim falhar:

1. Botão direito no atalho → `Propriedades`.
2. No fim do campo *Destino*, acrescente um espaço e as flags:
   ```
   "C:\Program Files\TVmakina\TVmakina.exe" --modo-leve --disable-gpu
   ```
3. Aplique e experimente. Se continuar a falhar, use o **Caminho A** (ficheiro
   HTML no Firefox) — não depende do Electron.

Flags disponíveis:

| Flag | Efeito |
|---|---|
| `--modo-leve` | força o modo leve |
| `--modo-normal` | desliga o modo leve |
| `--gpu` | reactiva a aceleração por hardware |
| `--disable-gpu` | desliga a aceleração por hardware |

---

## 3. Canais multicast da rede local (UDP)

Se o seu operador entrega televisão por **multicast** na rede de casa
(endereços `239.x.x.x`), o browser não os consegue ler sozinho — nenhum browser
consegue. É para isso que existe o proxy.

### 3.1 Ligar o proxy

Precisa de **Node.js** no computador que serve o vídeo (pode ser o próprio PC
fraco ou outro da rede). O **Node.js 14 LTS** corre em Windows 7 SP1.

```
cd C:\tvmakina
node server\proxy.js
```

Resposta:

```
 TVmakina Proxy 1.0.0  (Node v14.21.3)
 Interface: http://127.0.0.1:4022/
 Na rede:   http://192.168.1.35:4022/
 Estado:    http://127.0.0.1:4022/status
 UDP->HTTP: http://127.0.0.1:4022/udp/239.1.1.1:1234
```

Se o Windows perguntar, permita o acesso em **rede privada**.

Opções: `--port 4023`, `--iface 192.168.1.35`, `--max-buffer 2097152`, `--quiet`.

### 3.2 Usar no TVmakina

O endereço por omissão já é `127.0.0.1:4022`. Na lista M3U escreva normalmente:

```
#EXTINF:-1 group-title="Rede local",Canal 1
udp://@239.1.1.1:1234
```

Com várias placas de rede, indique qual:

```
udp://@239.1.1.1:1234?interface=192.168.1.35
```

O botão **Proxy:** no topo mostra `ligado` ou `desligado`; em
*Definições → Proxy UDP local* pode testar e mudar o endereço.

### 3.3 Já tem o udpxy?

O TVmakina é compatível: o udpxy também usa `/udp/<grupo>:<porta>`. Escreva o
endereço do udpxy em *Definições → Proxy UDP local* (por exemplo
`192.168.1.1:4022`) e clique em **Testar proxy**.

### 3.4 O que o nosso proxy tem a mais que o udpxy

- `/status` — estado em JSON: clientes, bytes, sockets, interface do IGMP join.
- `/scan` — procura servidores de media na rede (SSDP), útil para descobrir o
  servidor do operador.
- `/proxy?url=…` — reencaminha um stream HTTP que o browser bloqueia (CORS,
  certificado inválido, `http://` dentro de página `https://`).
- Serve a própria página do TVmakina em `http://127.0.0.1:4022/`.

---

## 4. Ajustes para o PC não se arrastar

O botão **Modo leve** (topo direito) liga-se sozinho quando detecta 2 núcleos
ou ~3 GB. O que muda:

| Ajuste | Normal | Modo leve |
|---|---|---|
| Buffer de vídeo | 12 s | **8 s** |
| Qualidade máxima | automática | **~720p (1,5 Mb/s)** |
| Logótipos na lista | ligados | **desligados** |
| Sombras e animações | ligadas | desligadas |
| Altura das linhas | 46 px | 40 px |
| Tentativas por canal | 2 | 1 |

E no EXE, para máquinas fracas:

| Ajuste | Valor |
|---|---|
| Heap do Chromium | 256 MB |
| Heap do processo principal | 128 MB |
| Processos de renderização | no máximo 2 |
| Cache em disco | 50 MB |
| Desligado | tradução, MediaRouter, OptimizationHints, BackForwardCache |
| Throttling em segundo plano | desligado (o vídeo não pára) |
| Janela | 1180×720, sem transparências |

Três coisas que ajudam num Core 2 Duo:

1. **Qualidade** na barra de controlos → *Até ~576p*. Um Core 2 Duo a 2.2 GHz
   não descodifica 1080p por software de forma fluida.
2. Feche outros programas — com 3 GB, cada 200 MB contam.
3. Olhe para **perdas** na barra de estado: se sobem, a CPU não acompanha.

---

## 5. Resolução de problemas

**"Este canal é HLS e este browser não tem suporte MSE"**
Está no Internet Explorer. Use o Firefox 115 ESR, o Chrome 109, ou o EXE.

**Erro 4 — origem não suportada**
Ou o endereço morreu, ou é `http://` com a página em `https://` (o browser
bloqueia), ou é multicast sem o proxy. Truque: abra o TVmakina a partir de
`http://127.0.0.1:4022/` (servido pelo proxy) — fica tudo em `http://` e o
bloqueio desaparece.

**Erro 3 — falha ao descodificar**
Codec que o Windows não descodifica (HEVC/H.265, por exemplo) ou CPU no limite.
Baixe a qualidade; se persistir, esse canal precisa de um codec instalado.

**Canal RTSP/RTMP/MMS marcado "SEM SUPORTE"**
É de propósito: browsers não reproduzem esses protocolos. O TVmakina marca-os
em vez de tentar e falhar em silêncio. Use a variante HTTP/HLS, se existir.

**A lista com muitos canais fica lenta**
Não deve ficar: a lista é virtualizada (só desenha as linhas visíveis). Se
ficar, desligue os logótipos em *Definições* — descarregar milhares de imagens
é o que pesa, não a lista.

**O proxy não responde**
Veja se o Node está a correr, se a porta 4022 não está ocupada, e se a Firewall
do Windows não bloqueou o Node na rede privada.

**A gravação não aparece**
A gravação usa o MediaRecorder do browser. No Internet Explorer não existe; no
Firefox e no Chrome/Chromium do Windows 7, existe.

---

## 6. O que está verificado e o que não está

Para não haver surpresas:

**Verificado automaticamente neste projecto** (`npm test`, 56 testes)
- analisador de listas (M3U real, XSPF, JSON, texto, duplicados, grupos, filtros);
- a interface completa dentro de um DOM: arranque, importação, lista
  virtualizada, procura sem acentos, favoritos, atalhos, sintonia por número,
  gravação, modo leve, mensagens de erro, retomar o último canal;
- o proxy `server/proxy.js` com **datagramas UDP reais** a chegar ao cliente
  HTTP, mais `/status`, `/`, e códigos de erro;
- a configuração do Electron para 3 GB / 2 núcleos (flags, limites, janela, GPU);
- que todo o código da aplicação continua em **ES5** (Chromium 108 / IE11);
- que o ficheiro único gerado volta a arrancar num DOM sem ficheiros externos.

**Não verificado aqui**
- **Correr o EXE num Windows 7 verdadeiro.** Este ambiente de trabalho não
  consegue descarregar o binário do Electron (o servidor de ficheiros do GitHub
  está bloqueado aqui), por isso o EXE só é gerado pelo GitHub Actions ou pelo
  `BUILD-WINDOWS.bat` num PC com Node.js e internet. Se algo falhar no Windows 7,
  o caminho de recurso é o **ficheiro HTML no Firefox 115 ESR**, que não depende
  do Electron.
- **Os endereços dos canais** dos catálogos públicos: este ambiente não tem
  acesso a esses servidores. Use os quatro **sinais de teste** incluídos — não
  precisam de rede e servem exactamente para confirmar que o vídeo funciona
  nessa máquina.
