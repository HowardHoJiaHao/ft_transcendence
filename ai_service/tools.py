import os
from contextvars import ContextVar
import httpx
from langchain.tools import tool
from rag import retrieve_faq_context

# ContextVar to store current request's user ID for auth proxying
user_id_var = ContextVar("user_id", default=0)

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")

def get_auth_headers():
    uid = user_id_var.get()
    headers = {}
    if uid > 0:
        headers["Authorization"] = f"Bearer token_{uid}"
    return headers

@tool
def search_listings(query: str = None, weight: str = None, flex: str = None, balance: str = None) -> str:
    """
    Search for badminton equipment and racket listings in the marketplace.
    Arguments:
    - query: optional text keyword (e.g. 'Astrox', 'Yonex')
    - weight: optional racket weight category (e.g. '3U', '4U', '5U')
    - flex: optional racket flexibility category (e.g. 'Stiff Shaft', 'Medium Flex', 'High Flexibility')
    - balance: optional racket balance category (e.g. 'Head Heavy', 'Even Balance', 'Head Light')
    """
    url = f"{BACKEND_URL}/api/v1/products"
    params = []
    
    if query:
        params.append(("search", query))
    if weight:
        params.append(("weightCategory", weight))
    if flex:
        params.append(("flexibilityCategory", flex))
    if balance:
        params.append(("balanceCategory", balance))
        
    try:
        response = httpx.get(url, params=params, headers=get_auth_headers(), timeout=5.0)
        if response.status_code == 200:
            data = response.json()
            products = data.get("products", [])
            if not products:
                return "No listings match the given search criteria."
                
            formatted = []
            for p in products:
                formatted.append(
                    f"Racket ID: {p.get('id')}\n"
                    f"Title: {p.get('title')}\n"
                    f"Price: RM {p.get('price')}\n"
                    f"Weight: {p.get('weightCategory')} | Flex: {p.get('flexibilityCategory')} | Balance: {p.get('balanceCategory')}\n"
                    f"Location: {p.get('location')} | Seller: {p.get('sellerName')} (Rating: {p.get('rating')}/5)\n"
                    f"Image URL: {p.get('image')}\n"
                    "---"
                )
            return "\n".join(formatted[:6])  # limit results to top 6
        else:
            return f"Error searching products: Go API returned HTTP {response.status_code}"
    except Exception as e:
        return f"Error contacting product backend: {e}"

@tool
def get_listing_detail(listing_id: int) -> str:
    """
    Retrieve full details of one specific badminton listing by its ID.
    Arguments:
    - listing_id: the numeric ID of the listing (e.g. 1, 2)
    """
    url = f"{BACKEND_URL}/api/v1/products/{listing_id}"
    try:
        response = httpx.get(url, headers=get_auth_headers(), timeout=5.0)
        if response.status_code == 200:
            p = response.json()
            return (
                f"Racket: {p.get('title')}\n"
                f"Price: RM {p.get('price')} (Original Price: RM {p.get('originalPrice', 'N/A')})\n"
                f"Description: {p.get('description')}\n"
                f"Weight: {p.get('weightCategory')} | Flex: {p.get('flexibilityCategory')} | Balance: {p.get('balanceCategory')}\n"
                f"Location: {p.get('location')}\n"
                f"Seller: {p.get('sellerName')} (Seller ID: {p.get('sellerId')}, Rating: {p.get('rating')}/5, Reviews: {p.get('reviews')})\n"
                f"Status: {p.get('status')} | Views: {p.get('viewsCount')}\n"
                f"Image URL: {p.get('image')}"
            )
        elif response.status_code == 404:
            return "Listing not found."
        else:
            return f"Error fetching listing details: HTTP {response.status_code}"
    except Exception as e:
        return f"Error calling product backend: {e}"

@tool
def get_seller_info(seller_id: int) -> str:
    """
    Retrieve a seller's profile details.
    Arguments:
    - seller_id: the numeric ID of the user/seller (e.g. 1, 2)
    """
    url = f"{BACKEND_URL}/api/v1/users/{seller_id}"
    try:
        response = httpx.get(url, headers=get_auth_headers(), timeout=5.0)
        if response.status_code == 200:
            s = response.json()
            return (
                f"Seller Profile:\n"
                f"Username: {s.get('username')}\n"
                f"Name: {s.get('first_name', '')} {s.get('last_name', '')}\n"
                f"Bio: {s.get('bio', 'No bio provided.')}\n"
                f"Verified: {s.get('is_verified', False)}"
            )
        elif response.status_code == 404:
            return "Seller not found."
        else:
            return f"Error fetching seller: HTTP {response.status_code}"
    except Exception as e:
        return f"Error calling user backend: {e}"

@tool
def get_user_profile() -> str:
    """
    Retrieve the current logged-in user's profile details. Requires user to be logged in.
    """
    if user_id_var.get() <= 0:
        return "You must be logged in to view your profile."
        
    url = f"{BACKEND_URL}/api/v1/me"
    try:
        response = httpx.get(url, headers=get_auth_headers(), timeout=5.0)
        if response.status_code == 200:
            u = response.json()
            return (
                f"Your Profile:\n"
                f"User ID: {u.get('id')}\n"
                f"Username: {u.get('username')}\n"
                f"Email: {u.get('email')}\n"
                f"Name: {u.get('first_name', '')} {u.get('last_name', '')}\n"
                f"Phone: {u.get('phone_no', 'N/A')}\n"
                f"Birthdate: {u.get('date_of_birth', 'N/A')}\n"
                f"Bio: {u.get('bio', '')}"
            )
        else:
            return "Failed to fetch profile. Please make sure you are logged in."
    except Exception as e:
        return f"Error fetching user profile: {e}"

@tool
def get_order_status(order_id: int) -> str:
    """
    Check the status and details of a specific order. Requires user to be logged in.
    Arguments:
    - order_id: the numeric order ID
    """
    if user_id_var.get() <= 0:
        return "You must be logged in to check order status."
        
    url = f"{BACKEND_URL}/api/v1/orders/{order_id}"
    try:
        response = httpx.get(url, headers=get_auth_headers(), timeout=5.0)
        if response.status_code == 200:
            o = response.json()
            return (
                f"Order #{o.get('id')} Details:\n"
                f"Listing ID: {o.get('listing_id')}\n"
                f"Seller ID: {o.get('seller_id')}\n"
                f"Quantity: {o.get('quantity')}\n"
                f"Total Price: RM {o.get('total_price')}\n"
                f"Payment Method: {o.get('payment_method')}\n"
                f"Status: {o.get('status')}\n"
                f"Created At: {o.get('created_at')}"
            )
        elif response.status_code == 404:
            return "Order not found."
        elif response.status_code in (401, 403):
            return "You are not authorized to view this order."
        else:
            return f"Error fetching order status: HTTP {response.status_code}"
    except Exception as e:
        return f"Error calling order backend: {e}"

@tool
def get_my_orders() -> str:
    """
    List the logged-in user's recent orders. Requires user to be logged in.
    """
    if user_id_var.get() <= 0:
        return "You must be logged in to view your orders."
        
    url = f"{BACKEND_URL}/api/v1/orders"
    try:
        response = httpx.get(url, headers=get_auth_headers(), timeout=5.0)
        if response.status_code == 200:
            orders = response.json()
            if not orders:
                return "You have no orders yet."
                
            formatted = []
            for o in orders:
                formatted.append(
                    f"Order #{o.get('id')}\n"
                    f"Listing ID: {o.get('listing_id')} | Qty: {o.get('quantity')}\n"
                    f"Total: RM {o.get('total_price')}\n"
                    f"Status: {o.get('status')}\n"
                    f"Ordered On: {o.get('created_at')}\n"
                    "---"
                )
            return "\n".join(formatted)
        else:
            return f"Error fetching orders: Go API returned HTTP {response.status_code}"
    except Exception as e:
        return f"Error calling order backend: {e}"

@tool
def get_faq_policies(query: str) -> str:
    """
    Search platform FAQs, user guides, policies, badminton terms, and how-to guides.
    Use this tool when users ask about delivery/mailing, meet ups, how to buy/sell, 
    account security, 2FA, or badminton racket specs (weight, balance, stiffness).
    Arguments:
    - query: a search term or question (e.g. 'how to buy', '3U weight')
    """
    context = retrieve_faq_context(query)
    if not context:
        return "No specific FAQ policies found for this query."
    return context

# List of all tools available to the agent
all_tools = [
    search_listings,
    get_listing_detail,
    get_seller_info,
    get_user_profile,
    get_order_status,
    get_my_orders,
    get_faq_policies
]
