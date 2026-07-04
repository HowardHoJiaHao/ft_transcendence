'use client'

import { useCart } from '@/context/CartContext'
import Header from '@/components/Header/Header'
import Link from 'next/link'
import styles from './cart.module.css'

export default function CartPage() {
	const { items, removeFromCart, updateQuantity, clearCart, total } = useCart();
	const getImageUrl = (url: string) => {
		if (!url)
			return 'https://via.placeholder.com/100';
		if (url.startsWith('http'))
			return url;
		return `/${url}`;
	};

	if (items.length === 0)
	{
		return (
			<main>
			  <Header />
			    <div className={styles.empty}>
                  <h2>Your cart is empty</h2>
                  <Link href="/" className="btn btn-primary">Continue Shopping</Link>
			    </div>
			</main>
		);
	}

	return (
		<main>
          <Header />
            <div className={styles.container}>
			  <h1>Shopping Cart ({items.length} items)</h1>

			  <div className={styles.layout}>
			    <div className={styles.items}>
				  {items.map(item => (
					<div key={item.id} className={styles.item}>
					  <img src={getImageUrl(item.image)} alt={item.title} className={styles.itemImage}/>
					  <div className={styles.itemInfo}>
						<h3>{item.title}</h3>
						<p className={styles.price}>RM {item.price.toFixed(2)}</p>
					  </div>
					  <div className="quantitySelector">
						<button className="quantityBtn" onClick={() => updateQuantity(item.id, item.quantity - 1)}>-</button>
						<span className="quantityDisplay"> {item.quantity} </span>
						<button className="quantityBtn "onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
					  </div>
					  <p className={styles.subtotal}>RM {(item.price * item.quantity).toFixed(2)}</p>
					  <button className={styles.removeBtn} onClick={() => removeFromCart(item.id)}>✕</button>
					</div>
				  ))}
				</div>

				<div className={styles.summary}>
				  <h3>Order Summary</h3>
				  <div className={styles.summaryRow}>
				    <span>Subtotal</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  <div className={styles.summaryRow}>
					<span>Shipping</span>
					<span>Free</span>
				  </div>
				  <div className={styles.summaryRow + ' ' + styles.total}>
					<span>Total</span>
					<span>RM {total.toFixed(2)}</span>
				  </div>
				  <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>Checkout</button>
				  <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px' }} onClick={clearCart}>Clear cart</button>
				</div>
			  </div>
			</div>
		</main>
	);
}