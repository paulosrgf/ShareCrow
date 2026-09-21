# Sharecrow

Um aplicativo desktop leve para compartilhamento de tela em tempo real, inspirado na simplicidade de usabilidade do Discord. Construído com **Electron** e **WebRTC**, o Sharecrow estabelece conexões P2P diretas entre os usuários com latência mínima, sem a necessidade de configurações complexas de rede por parte do usuário final.

## Funcionalidades

- **Experiência "Instalar e Usar":** Sem terminais, sem configurações. Apenas baixe o executável, abra e compartilhe.
- **Conexões P2P de Baixa Latência:** Streaming de vídeo nativo via WebRTC.
- **Seletor de Janelas:** Escolha compartilhar a tela inteira ou apenas um aplicativo específico (evitando o efeito de espelho infinito).
- **Sinalização Transparente:** Conexão automática via WebSockets com o backend na nuvem.

## 🛠️ Tecnologias Utilizadas

- [Electron](https://www.electronjs.org/) (Framework Desktop)
- [WebRTC](https://webrtc.org/) (Protocolo de mídia P2P)
- [Node.js](https://nodejs.org/)

## Como rodar em modo de desenvolvimento

Certifique-se de ter o **Node.js** e o **npm** instalados.

1. Clone o repositório:
   ```bash
   git clone [https://github.com/paulosrgf/sharecrow.git]
   cd sharecrow
