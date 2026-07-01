FROM ghcr.io/hostinger/hvps-hermes-agent:latest

WORKDIR /bridge

COPY services/hermes-bridge/server.py /bridge/server.py

EXPOSE 8787

ENTRYPOINT ["python3", "/bridge/server.py"]
