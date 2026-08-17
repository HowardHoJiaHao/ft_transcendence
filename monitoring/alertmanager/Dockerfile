FROM python:3.12-slim

WORKDIR /app
# Bake the relay program into the image. Do not bind-mount this file.
COPY discord_webhook_bridge.py /app/discord_webhook_bridge.py

CMD ["python", "/app/discord_webhook_bridge.py"]
