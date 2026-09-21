# Signal TV — Windows EXE

## Gerar o instalador no Windows

1. Instale Node.js 20 LTS ou superior.
2. Abra o PowerShell nesta pasta.
3. Execute:

```powershell
npm install
npm run dist:win
```

Os ficheiros serão criados na pasta `release/`:
- Instalador NSIS: `Signal TV Setup 1.0.0.exe`
- Versão portátil: `Signal TV 1.0.0.exe` (o nome exato pode variar)

## Testar sem criar instalador

```powershell
npm install
npm run electron:dev
```

## Compilação sem Node.js local

Este projeto inclui `.github/workflows/build-windows.yml`. Envie o projeto para o GitHub,
abra **Actions**, execute **Build Signal TV for Windows** e baixe o artefato gerado.
