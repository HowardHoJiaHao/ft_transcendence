import os
from contextvars import ContextVar
import httpx
from langchain.tools import tool
from rag import retrieve_faq_context
from recommender import (
    ModelPredictionError,
    ModelUnavailableError,
    RecommendationProfileError,
    predict_racket_specs,
)

# ContextVar to store current request's user ID for auth proxying
user_id_var = ContextVar("user_id", default=0)

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")

def _format_products(products, limit: int = None) -> str:
    safe_limit = None
    if isinstance(limit, int) and limit > 0:
        safe_limit = limit
    formatted = []
    for p in products:
        formatted.append(
            f"Racket ID: {p.get('id')}\n"
            f"Title: {p.get('title')}\n"
            f"Price: RM {p.get('price')}\n"
            f"Weight: {p.get('weightCategory')} | Flex: {p.get('flexibilityCategory')} | Balance: {p.get('balanceCategory')}\n"
            f"Location: {p.get('location')} | Seller: {p.get('sellerName')} (Rating: {p.get('rating')}/5)\n"
            f"Product link: {p.get('title')} | /products/{p.get('id')}\n"
            "---"
        )
    if safe_limit is None:
        return "\n".join(formatted)
    return "\n".join(formatted[:safe_limit])

def _fetch_products(params):
    response = httpx.get(
        f"{BACKEND_URL}/api/v1/products",
        params=params,
        headers=get_auth_headers(),
        timeout=5.0,
    )
    if response.status_code != 200:
        return None, f"Error searching products: Go API returned HTTP {response.status_code}"
    return response.json().get("products", []), None

def _beginner_score(product):
    score = 0
    weight = (product.get("weightCategory") or "").upper()
    flex = product.get("flexibilityCategory") or ""
    balance = product.get("balanceCategory") or ""

    if weight in ("5U", "6U", "7U"):
        score += 3
    elif weight == "8U":
        score += 2
    elif weight == "4U":
        score += 1
    elif weight in ("1U", "2U", "3U"):
        score -= 3

    if flex == "Medium Flex":
        score += 3
    elif flex == "High Flexibility":
        score += 2
    elif flex == "Stiff Shaft":
        score -= 2

    if balance == "Even Balance":
        score += 3
    elif balance == "Head Light":
        score += 2
    elif balance == "Head Heavy":
        score -= 2

    price = product.get("price")
    if isinstance(price, (int, float)) and price <= 300:
        score += 1

    return score

def _format_beginner_products(products) -> str:
    formatted = []
    for p in products:
        formatted.append(
            f"[ Racket ID: {p.get('id')} — {p.get('title')} ]\n"
            f"Price: RM {p.get('price')}\n"
            f"Weight: {p.get('weightCategory')}\n"
            f"Flex: {p.get('flexibilityCategory')}\n"
            f"Balance: {p.get('balanceCategory')}\n"
            f"Location: {p.get('location')}\n"
            f"Seller: {p.get('sellerName')} (Rating: {p.get('rating')}/5)\n"
            f"Best for: Beginner-friendly handling and easier timing\n"
            f"Product link: {p.get('title')} | /products/{p.get('id')}"
        )
    return "\n\n".join(formatted)

def _budget_filters(budget_range):
    if budget_range in ("under-200", "under_200"):
        return {"max_price": 200}
    if budget_range == "200-400":
        return {"min_price": 200, "max_price": 400}
    if budget_range == "400-700":
        return {"min_price": 400, "max_price": 700}
    if budget_range in ("700+", "700_plus"):
        return {"min_price": 700}
    return {}

def _profile_budget_label(budget_range):
    labels = {
        "under-200": "Under RM200",
        "under_200": "Under RM200",
        "200-400": "RM200 - RM400",
        "400-700": "RM400 - RM700",
        "700+": "RM700+",
        "700_plus": "RM700+",
    }
    return labels.get(budget_range, budget_range or "your budget")

def _dedupe_products(products):
    seen = set()
    deduped = []
    for product in products:
        key = (
            str(product.get("title") or "").strip().lower(),
            str(product.get("weightCategory") or "").strip().lower(),
            str(product.get("flexibilityCategory") or "").strip().lower(),
            str(product.get("balanceCategory") or "").strip().lower(),
            str(product.get("price") or "").strip(),
            str(product.get("sellerName") or "").strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(product)
    return deduped

def _profile_reason(profile, specs):
    reasons = []
    experience = profile.get("experience_level")
    play_style = profile.get("play_style")

    weight = specs.get("weightCategory")
    flex = specs.get("flexibilityCategory")
    balance = specs.get("balanceCategory")

    if weight:
        reasons.append(f"{weight} gives a practical weight target for your current profile.")
    if flex:
        if experience in ("less_than_6_months", "6_months-1_year", "6_months_1_year"):
            reasons.append(f"{flex} helps make power generation easier while your timing develops.")
        else:
            reasons.append(f"{flex} matches a more developed swing and gives predictable shuttle feedback.")
    if balance:
        if play_style == "attacking":
            reasons.append(f"{balance} supports your attacking preference without ignoring control.")
        elif play_style == "defensive":
            reasons.append(f"{balance} keeps handling quick enough for defensive exchanges.")
        elif play_style == "balanced":
            reasons.append(f"{balance} suits an all-round game.")
        else:
            reasons.append(f"{balance} is a sensible neutral target while you refine your style.")

    return reasons[:3]

def _format_profile_products(products) -> str:
    formatted = []
    for p in products:
        formatted.append(
            f"[ Racket ID: {p.get('id')} - {p.get('title')} ]\n"
            f"Price: RM {p.get('price')}\n"
            f"Weight: {p.get('weightCategory')}\n"
            f"Flex: {p.get('flexibilityCategory')}\n"
            f"Balance: {p.get('balanceCategory')}\n"
            f"Location: {p.get('location')}\n"
            f"Seller: {p.get('sellerName')} (Rating: {p.get('rating')}/5)\n"
            f"Product link: {p.get('title')} | /products/{p.get('id')}"
        )
    return "\n\n".join(formatted)

def _recommendation_search_params(specs, profile, relaxed=None):
    relaxed = set(relaxed or [])
    params = []
    budget = _budget_filters(profile.get("budget_range"))

    if "weight" not in relaxed and specs.get("weightCategory"):
        params.append(("weightCategory", specs["weightCategory"]))
    if "flex" not in relaxed and specs.get("flexibilityCategory"):
        params.append(("flexibilityCategory", specs["flexibilityCategory"]))
    if "balance" not in relaxed and specs.get("balanceCategory"):
        params.append(("balanceCategory", specs["balanceCategory"]))
    if "budget" not in relaxed:
        if budget.get("min_price") is not None:
            params.append(("minPrice", budget["min_price"]))
        if budget.get("max_price") is not None:
            params.append(("maxPrice", budget["max_price"]))

    params.extend([("sort", "rating"), ("limit", 3)])
    return params

def _fetch_profile_matches(specs, profile):
    attempts = [
        ([], "exact"),
        (["balance"], "balance_differs"),
        (["flex", "balance"], "flex_or_balance_differs"),
        (["budget"], "budget_differs"),
        (["flex", "balance", "budget"], "loose_alternatives"),
    ]

    for relaxed, label in attempts:
        products, error = _fetch_products(_recommendation_search_params(specs, profile, relaxed))
        if error:
            return [], label, error
        deduped_products = _dedupe_products(products)
        if deduped_products:
            return deduped_products, label, None

    products, error = _fetch_products([("sort", "rating"), ("limit", 3)])
    if error:
        return [], "broader marketplace alternatives", error
    return _dedupe_products(products or []), "broader_marketplace", None

def _fallback_tradeoff_message(match_label, specs, profile):
    spec_text = (
        f"{specs.get('weightCategory')}, "
        f"{specs.get('flexibilityCategory')}, "
        f"{specs.get('balanceCategory')}"
    )
    budget_text = _profile_budget_label(profile.get("budget_range"))
    messages = {
        "balance_differs": (
            f"I could not find an exact {spec_text} racket within {budget_text}. "
            "The closest options keep your recommended weight and flex, but use a different balance."
        ),
        "flex_or_balance_differs": (
            f"I could not find an exact {spec_text} racket within {budget_text}. "
            "The closest options stay near your recommended weight and budget, but flex or balance may differ."
        ),
        "budget_differs": (
            f"I could not find an exact {spec_text} racket within {budget_text}. "
            "The closest options match the recommended specs, but sit outside your selected budget."
        ),
        "loose_alternatives": (
            f"I could not find a strong match for {spec_text} within {budget_text}. "
            "These only keep the recommended weight, so treat them as loose alternatives."
        ),
        "broader_marketplace": (
            f"I could not find a close match for {spec_text} within {budget_text}. "
            "Here are broader marketplace alternatives."
        ),
    }
    return messages.get(
        match_label,
        "I could not find an exact match right now, so here are the closest available rackets.",
    )

def _fallback_profile_recommendations(profile, message):
    budget = _budget_filters(profile.get("budget_range"))
    max_price = budget.get("max_price") or 300
    fallback = get_beginner_recommendations.invoke(
        {
            "max_price": max_price,
            "limit": 3,
            "avoid_limit": 0,
            "include_guide": True,
            "include_avoid": False,
        }
    )
    return f"{message}\n\n{fallback}"

def get_auth_headers():
    uid = user_id_var.get()
    headers = {}
    if uid > 0:
        headers["Authorization"] = f"Bearer token_{uid}"
    return headers

@tool
def search_listings(
    query: str = None,
    weight: str = None,
    flex: str = None,
    balance: str = None,
    min_price: float = None,
    max_price: float = None,
    sort: str = None,
    limit: int = None,
) -> str:
    """
    Search for badminton equipment and racket listings in the marketplace.
    Arguments:
    - query: optional text keyword (e.g. 'Astrox', 'Yonex')
    - weight: optional racket weight category (e.g. '3U', '4U', '5U')
    - flex: optional racket flexibility category (e.g. 'Stiff Shaft', 'Medium Flex', 'High Flexibility')
    - balance: optional racket balance category (e.g. 'Head Heavy', 'Even Balance', 'Head Light')
    - min_price: optional minimum price in RM
    - max_price: optional maximum price in RM
    - sort: optional sorting mode ('price-low', 'price-high', 'newest', or 'rating')
    - limit: optional number of listings to include in the response
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
    if min_price is not None:
        params.append(("minPrice", min_price))
    if max_price is not None:
        params.append(("maxPrice", max_price))
    if sort:
        params.append(("sort", sort))
        
    try:
        products, error = _fetch_products(params)
        if error:
            return error
        if products:
            return _format_products(products, limit=limit)

        fallback_sections = []

        strict_specs = weight or flex or balance or min_price is not None or max_price is not None
        if query and strict_specs:
            spec_params = [(key, value) for key, value in params if key != "search"]
            spec_products, spec_error = _fetch_products(spec_params)
            if spec_error:
                return spec_error
            if spec_products:
                fallback_sections.append(
                    "No exact brand match found. Similar rackets matching your specs:\n"
                    + _format_products(spec_products, limit=limit)
                )

            brand_products, brand_error = _fetch_products([("search", query)])
            if brand_error:
                return brand_error
            if brand_products:
                fallback_sections.append(
                    f"Available {query} rackets with different specs:\n"
                    + _format_products(brand_products, limit=limit)
                )

        if fallback_sections:
            return "\n\n".join(fallback_sections)

        return "No listings match the given search criteria."
    except Exception as e:
        return f"Error contacting product backend: {e}"

@tool
def get_profile_based_recommendations(
    age_group: str,
    gender: str,
    experience_level: str,
    play_style: str,
    budget_range: str,
) -> str:
    """
    Recommend marketplace rackets from a completed structured assessment profile.
    Arguments:
    - age_group: controlled age group value from the chatbot assessment
    - gender: controlled gender value from the chatbot assessment
    - experience_level: controlled experience value from the chatbot assessment
    - play_style: controlled play style value from the chatbot assessment
    - budget_range: controlled budget value from the chatbot assessment
    """
    profile = {
        "age_group": age_group,
        "gender": gender,
        "experience_level": experience_level,
        "play_style": play_style,
        "budget_range": budget_range,
    }

    try:
        specs = predict_racket_specs(profile)
    except RecommendationProfileError as exc:
        return f"I need a complete assessment profile before recommending a racket, Boss. {exc}"
    except ModelUnavailableError as exc:
        print(f"Racket recommender unavailable: {exc}")
        return _fallback_profile_recommendations(
            profile,
            "The ML recommender is not available yet, Boss. I will use the basic racket guide for now.",
        )
    except ModelPredictionError as exc:
        print(f"Racket recommender prediction failed: {exc}")
        return _fallback_profile_recommendations(
            profile,
            "The ML recommender had trouble reading that profile, Boss. I will use the basic racket guide for now.",
        )
    except Exception as exc:
        print(f"Unexpected racket recommender error: {exc}")
        return _fallback_profile_recommendations(
            profile,
            "The ML recommender hit an issue, Boss. I will use the basic racket guide for now.",
        )

    products, match_label, error = _fetch_profile_matches(specs, profile)
    if error:
        return f"Your profile points to {specs.get('weightCategory')}, {specs.get('flexibilityCategory')}, {specs.get('balanceCategory')}, but I could not search listings right now. {error}"

    confidence = specs.get("confidence")
    confidence_line = f"\nConfidence: {confidence}" if confidence is not None else ""
    reasons = "\n".join(f"- {reason}" for reason in _profile_reason(profile, specs))
    budget_label = _profile_budget_label(profile.get("budget_range"))

    sections = [
        "Based on your assessment, I recommend:",
        f"Weight: {specs.get('weightCategory')}\nFlex: {specs.get('flexibilityCategory')}\nBalance: {specs.get('balanceCategory')}{confidence_line}",
        f"Budget considered: {budget_label}",
        f"Why this fits:\n{reasons}",
    ]

    if not products:
        sections.append(
            "I could not find matching rackets in the marketplace right now. Try a broader budget or check again later lah."
        )
        return "\n\n".join(sections)

    if match_label != "exact":
        sections.append(_fallback_tradeoff_message(match_label, specs, profile))
    else:
        sections.append("Recommended marketplace listings:")

    sections.append(_format_profile_products(products))
    return "\n\n".join(sections)

@tool
def get_beginner_recommendations(
    max_price: float = 300,
    limit: int = None,
    avoid_limit: int = None,
    include_guide: bool = True,
    include_avoid: bool = True,
) -> str:
    """
    Recommend beginner-friendly badminton rackets from marketplace listings.
    Use this when users ask for beginner, newbie, first racket, or new player recommendations.
    Arguments:
    - max_price: optional maximum price in RM, defaults to 300 for first-racket budget picks.
    - limit: optional number of recommended listings to return.
    - avoid_limit: optional number of less suitable listings to mention.
    - include_guide: whether to include the beginner guide section (default True).
    - include_avoid: whether to include less suitable listings (default True).
    """
    try:
        products, error = _fetch_products([("maxPrice", max_price), ("sort", "price-low")])
        if error:
            return error
        if not products:
            return "No beginner-friendly listings found within that budget right now."

        ranked = sorted(products, key=_beginner_score, reverse=True)
        if isinstance(limit, int) and limit > 0:
            safe_limit = limit
        else:
            safe_limit = len(ranked)

        if isinstance(avoid_limit, int) and avoid_limit >= 0:
            safe_avoid_limit = avoid_limit
        else:
            safe_avoid_limit = len(ranked)

        recommended = [p for p in ranked if _beginner_score(p) > 0][:safe_limit]
        avoid = [p for p in ranked if _beginner_score(p) <= 0][:safe_avoid_limit]

        if not recommended:
            recommended = ranked[:safe_limit]

        sections = []
        if include_guide:
            sections.append(
                "Beginner racket guide:\n"
                "- Weight: 5U to 8U is easier on your wrist and arm.\n"
                "- Flex: High Flexibility or Medium Flex helps generate easy power.\n"
                "- Balance: Even Balance or Head Light is easier to control.\n"
                "- String tension: 18-23 lbs gives a bigger sweet spot."
            )

        sections.append("Recommended beginner-friendly listings:\n" + _format_beginner_products(recommended))

        if include_avoid and avoid:
            avoid_lines = []
            for p in avoid:
                avoid_lines.append(
                    f"{p.get('title')} (Racket ID: {p.get('id')}) — "
                    f"{p.get('weightCategory')}, {p.get('flexibilityCategory')}, {p.get('balanceCategory')}"
                )
            sections.append(
                "Less beginner-friendly options to avoid for now:\n"
                + "\n".join(avoid_lines)
            )

        return "\n\n".join(sections)
    except Exception as e:
        return f"Error finding beginner recommendations: {e}"

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
                f"Status: {p.get('status')} | Views: {p.get('viewsCount')}"
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
    get_profile_based_recommendations,
    get_listing_detail,
    get_seller_info,
    get_user_profile,
    get_order_status,
    get_my_orders,
    get_beginner_recommendations,
    get_faq_policies
]
