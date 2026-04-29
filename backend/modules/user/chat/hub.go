//go:build ignore

import (

)

type OutgoingMessage struct {
	ToUserId	int
	Payload		[]byte
}

type Client struct {
	Hub			*Hub
	Conn		*websocket.Conn
	Send		chan []byte
	UserId		int
}

type Hub struct {
	Clients		map[int]*Client
	Send		chan OutgoingMessage
	Broadcast	chan []byte
	Register	chan *Client
	Unregister	chan int
}

func NewHub() *Hub {
	return &Hub{
		Clients:	make(map[int] *Client),
		Send:		make(chan OutgoingMessage, 256)
		Broadcast:	make(chan []byte, 256),
		Register:	make(chan *Client, 256),
		Unregister:	make(chan int, 256),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Clients[client.UserId] = client
			log.Printf("✓ User %d connected(%d online)", client.UserId, len(h.Clients))

		case userId := <- h.Unregister:
			if Client, ok := h.Clients[userId]; ok {
				client.Conn.Close()
				delete(h.Clients, userId)
				log.Printf("✗ User %d disconnected(%d online)", userId, len)
			}

		case msg := <- h.Send:
			if client, ok := h.Clients[msg.ToUserId]; ok {
				select {
				case client.Send <- msg.Payload
				default:
					client.Conn.close()
					delete(h.Clients, msg.ToUserId)
				}
			}
		case message := <- h.Broadcast:
			for userId, client := range h.Clients { // range means that for loop has access to h.Clients and userId, client comes from what range return for map which key and value
				select {
				case client.Send <- message:
				default:
					client.Conn.Close()
					delete(h.Clients, userId)
				}
			}
		}
	}
}

func (h *Hub) SendPrivateMessage(toUserId int, data []byte) {
	h.Send  <- OutgoingMessage{ToUserId: toUserId, Payload: data}
}

var upgrader = websocket.Upgrader {
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}