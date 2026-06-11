FROM python:3.12-slim

WORKDIR /app

COPY index.html app.js styles.css server.py ./

ENV HOST=0.0.0.0
ENV PORT=5174
ENV LINLIN_DATA_DIR=/app/data

EXPOSE 5174

CMD ["python", "server.py"]
