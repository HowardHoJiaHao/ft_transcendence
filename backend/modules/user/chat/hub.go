package chat

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

type OutgoingMessage struct {
	ToUserId int
	Payload  []byte
}

type Client struct {
	Hub    *Hub
	Conn   *websocket.Conn
	Send   chan []byte
	UserId int
}

type Hub struct {
	Clients    map[int]*Client
	Send       chan OutgoingMessage
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan int
	Snapshots  chan chan []int
	Repo       *Repository
}

func NewHub(repo *Repository) *Hub {
	return &Hub{
		Clients:    make(map[int]*Client),
		Send:       make(chan OutgoingMessage, 256),
		Broadcast:  make(chan []byte, 256),
		Register:   make(chan *Client, 256),
		Unregister: make(chan int, 256),
		Snapshots:  make(chan chan []int),
		Repo:       repo,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Clients[client.UserId] = client
			log.Printf("✓ User %d connected(%d online)", client.UserId, len(h.Clients))
			//				GIVE EXISTING ONLINE LIST TO NEW CLIENT
			userIds := make([]int, 0, len(h.Clients))
			for userId := range h.Clients {
				// if userId == client.UserId {
				// 	continue
				// }
				userIds = append(userIds, userId)
			}
			initialMsg := OnlineUsersMessage{
				Type:    "online_users",
				UserIds: userIds,
			}
			initialPayload, _ := json.Marshal(initialMsg)
			select {
			case client.Send <- initialPayload:
			default:
			}
			//			GIVE NEW CLIENT ONLINE NOTI TO EXISTING CLIENTS
			onlineMsg := OnlineStatusMessage{
				Type:   "user_online",
				UserId: client.UserId,
			}
			payload, _ := json.Marshal(onlineMsg)
			for _, c := range h.Clients {
				if c.UserId != client.UserId {
					select {
					case c.Send <- payload:
					default:
					}
				}
			}

		case userId := <-h.Unregister:
			if Client, ok := h.Clients[userId]; ok {
				Client.Conn.Close()
				delete(h.Clients, userId)
				log.Printf("✗ User %d disconnected(%d online)", userId, len(h.Clients))
			}
			offlineMsg := OnlineStatusMessage{
				Type:   "user_offline",
				UserId: userId,
			}
			payload, _ := json.Marshal(offlineMsg)
			for _, c := range h.Clients {
				select {
				case c.Send <- payload:
				default:
				}
			}

		case reply := <-h.Snapshots:
			userIDs := make([]int, 0, len(h.Clients))
			for userID := range h.Clients {
				userIDs = append(userIDs, userID)
			}
			reply <- userIDs

		case msg := <-h.Send:
			if client, ok := h.Clients[msg.ToUserId]; ok {
				select {
				case client.Send <- msg.Payload:
				default:
					client.Conn.Close()
					delete(h.Clients, msg.ToUserId)
				}
			}
		case message := <-h.Broadcast:
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

// OnlineUserIDs returns a consistent snapshot without accessing the hub map
// outside the hub's event loop.
func (h *Hub) OnlineUserIDs(ctx context.Context) ([]int, error) {
	reply := make(chan []int, 1)
	select {
	case h.Snapshots <- reply:
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	select {
	case userIDs := <-reply:
		return userIDs, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (h *Hub) SendPrivateMessage(toUserId int, data []byte) {
	h.Send <- OutgoingMessage{ToUserId: toUserId, Payload: data}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		//implement validation
		return true
	},
}

func (h *Hub) ServeWS(c echo.Context, userId int) error {
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Println("Websocket upgrade error:", err)
		return err
	}
	client := &Client{
		Hub:    h,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		UserId: userId,
	}
	h.Register <- client
	go client.readPump(h)
	go client.writePump()

	return nil
}

func (c *Client) readPump(h *Hub) {
	defer func() {
		h.Unregister <- c.UserId
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(512 * 1024)                          //set limit 5KB. prevent user from sending too big data. it can crash the server
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //handle request takes more than 60 sec
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage() //sort of like poll. wait user gives message
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error (user %d): %v", c.UserId, err)
			}
			break
		}

		var inbound InboundMessage
		if err := json.Unmarshal(message, &inbound); err != nil {
			log.Printf("JSON parse error: %v", err)
			continue
		}

		//store in database and retake
		//h.repo.createmessage
		repo := h.Repo
		if repo == nil {
			log.Printf("No chat repo in context for user %d", c.UserId)
			continue
		}

		msg, err := repo.CreateMessage(c.UserId, inbound.ReceiverId, inbound.Content)
		if err != nil {
			log.Printf("Failed to save message: %v", err)
			continue
		}

		outbound := OutboundMessage{
			Type:       "private_message",
			SenderId:   msg.SenderId,
			ReceiverId: msg.ReceiverId,
			Content:    msg.Content,
			CreatedAt:  msg.CreatedAt.Format(time.RFC3339),
			Id:         msg.Id,
		}

		payload, _ := json.Marshal(outbound)
		h.SendPrivateMessage(msg.ReceiverId, payload)
		h.SendPrivateMessage(msg.SenderId, payload)
	}
}

// writemessage parameters are 1) message type 2) the payload
func (c *Client) writePump() {
	//create a heartbeat timer
	ticker := time.NewTicker(54 * time.Second)
	//defer function
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()
	//loop forever
	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
