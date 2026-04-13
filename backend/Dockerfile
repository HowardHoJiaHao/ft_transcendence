FROM golang:1.25.8-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git gcc musl-dev

# Copy go mod files
COPY go.mod go.sum ./
# test
RUN go mod download

# Copy source code first
COPY . .
# test
RUN CGO_ENABLED=1 GOOS=linux go build -mod=readonly -a -installsuffix cgo -o main .

# Build the application with -mod=mod to allow downloading during build. GOOS=linux ensure output works on Linux
# RUN CGO_ENABLED=1 GOOS=linux go build -mod=mod -a -installsuffix cgo -o main .

# Final stage
FROM alpine:3.18

# add ca-certificates allow adding ssl certidicates
RUN apk --no-cache add ca-certificates postgresql-client

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main .

EXPOSE 8080

CMD ["./main"]
