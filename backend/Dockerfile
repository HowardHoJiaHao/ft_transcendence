FROM golang:1.25.8-alpine AS builder
#alpine is specialised to build and compile the go source code to /app/main

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git gcc musl-dev

# Copy go mod files
# go.mod and go.sum are used to build dependency setup, go.sum is checksum for verifications
COPY go.mod go.sum ./
# test
RUN go mod download

# Copy source code first, first . refer to /backend/, second . refer to workdir /app
COPY . .
# test
# compile it, main.go, products.go, orders.go... to /app/main , now a go program has created
RUN CGO_ENABLED=1 GOOS=linux go build -mod=readonly -a -installsuffix cgo -o main .

# Build the application with -mod=mod to allow downloading during build. GOOS=linux ensure output works on Linux
# RUN CGO_ENABLED=1 GOOS=linux go build -mod=mod -a -installsuffix cgo -o main .

# Final stage, this is to create the final runtime image, another version specialised
# in compiling go server program
FROM alpine:3.18

# add ca-certificates allow adding ssl certidicates
RUN apk --no-cache add ca-certificates postgresql-client

WORKDIR /app

# Copy binary from builder, from the previous newly created program
COPY --from=builder /app/main .

# Create static directories so volume mounts work properly
RUN mkdir -p /app/static/avatars /app/static/listings

EXPOSE 8080

#output is a container image
CMD ["./main"]
