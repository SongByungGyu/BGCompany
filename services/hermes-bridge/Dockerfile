FROM ghcr.io/hostinger/hvps-hermes-agent:latest

WORKDIR /bridge

COPY services/hermes-bridge/server.py /bridge/server.py

EXPOSE 8787

CMD ["python3", "/bridge/server.py"]
