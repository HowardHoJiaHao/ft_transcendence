'use client';

import { useState, useEffect } from 'react'; //std react hook for managing local state & side effects
import { useRouter } from 'next/navigation'; //programmatic navigation
import { useAuth } from '@/modules/user/components/AuthContext'; //import hook to access global authentication data
import styles from './page.module.css'; //import CSS module for scope styling

interface Product
{
  id: number;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  category: string;
  location: string;
  seller: string;
  rating: number;
  reviews: number;
  isNew: boolean;
  isFeatured: boolean;
}

const CATEGORIES = [
  'All',
  'Electronics',
  'Furniture',
  'Fashion',
  'Sports',
  'Books',
  'Vehicles',
];

export default function Home() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch products from API
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoading(true);
        const query = new URLSearchParams();
        if (selectedCategory !== 'All') {
          query.append('category', selectedCategory);
        }
        if (searchQuery) {
          query.append('search', searchQuery);
        }
        query.append('sort', sortBy);

        const response = await fetch(
          `http://localhost:8080/api/v1/products?${query}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch products');
        }

        const data = await response.json();
        const mappedProducts = data.products.map((p: any) => ({ //for every single data call everything for a while then take the p and turn it into object below
          id: p.id,
          title: p.title,
          price: parseFloat(p.price),
          originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
          image: p.image,
          category: p.category,
          location: p.location,
          seller: p.seller,
          rating: parseFloat(p.rating),
          reviews: p.reviews,
          isNew: p.isNew,
          isFeatured: p.isFeatured,
        }));

        setProducts(mappedProducts);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [selectedCategory, searchQuery, sortBy]);

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div className="container">
          <div className={styles.headerTop}>
            <h1 className={styles.logo}>🛍️ Transcendence</h1>
            <div className={styles.headerActions}>
              {user ? (
                <>
                  <span className={styles.welcomeText}>Hi, {user.username}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => router.push('/profile')}>Profile</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => router.push('/friends')}>Friends</button>
                  <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
                </>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => router.push('/login')}>Login</button>
              )}
              <button className="btn btn-primary btn-sm">Sell Now</button>
            </div>
          </div>

          {/* Search Bar */}
          <div className={styles.searchContainer}>
            <div className={styles.searchBox}>
              <input
                type="text"
                placeholder="Search listings, items, sellers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
              <button className="btn btn-primary">Search</button>
            </div>
          </div>

          {/* Categories */}
          <div className={styles.categoriesNav}>
            {CATEGORIES.map((category) => (
              <button
                key={category}
                className={`${styles.categoryBtn} ${
                  selectedCategory === category ? styles.active : ''
                }`}
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container">
        <div className={styles.content}>
          {/* Sidebar Filters */}
          <aside className={styles.sidebar}>
            <div className={styles.filterSection}>
              <h3>Price Range</h3>
              <input type="range" min="0" max="5000" className={styles.slider} />
              <div className={styles.priceRange}>
                <span>RM 0</span>
                <span>RM 5000+</span>
              </div>
            </div>

            <div className={styles.filterSection}>
              <h3>Location</h3>
              <div className={styles.filterOptions}>
                <label>
                  <input type="checkbox" /> Kuala Lumpur
                </label>
                <label>
                  <input type="checkbox" /> Petaling Jaya
                </label>
                <label>
                  <input type="checkbox" /> Shah Alam
                </label>
                <label>
                  <input type="checkbox" /> All Locations
                </label>
              </div>
            </div>

            <div className={styles.filterSection}>
              <h3>Condition</h3>
              <div className={styles.filterOptions}>
                <label>
                  <input type="checkbox" defaultChecked /> New
                </label>
                <label>
                  <input type="checkbox" defaultChecked /> Used
                </label>
              </div>
            </div>

            <div className={styles.filterSection}>
              <h3>Rating</h3>
              <div className={styles.filterOptions}>
                <label>
                  <input type="checkbox" /> 4.5+ ⭐
                </label>
                <label>
                  <input type="checkbox" /> 4.0+ ⭐
                </label>
                <label>
                  <input type="checkbox" /> 3.5+ ⭐
                </label>
              </div>
            </div>
          </aside>

          {/* Products */}
          <div className={styles.productsSection}>
            {/* Sort Controls */}
            <div className={styles.sortBar}>
              <span>{products.length} results found</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className={styles.sortSelect}
              >
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="rating">Highest Rating</option>
              </select>
            </div>

            {/* Products Grid */}
            {loading ? (
              <div className={styles.noResults}>
                <p>Loading products...</p>
              </div>
            ) : error ? (
              <div className={styles.noResults}>
                <p>Error: {error}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </button>
              </div>
            ) : products.length > 0 ? (
              <div className={styles.productsGrid}>
                {products.map((product) => (
                  <div key={product.id} className={styles.productCard}>
                    <div className={styles.productImage}>
                      <img src={product.image} alt={product.title} />
                      {product.isFeatured && (
                        <span className={`badge badge-primary ${styles.badgeFeatured}`}>
                          Featured
                        </span>
                      )}
                      {product.isNew && (
                        <span className={`badge badge-success ${styles.badgeNew}`}>
                          New
                        </span>
                      )}
                    </div>

                    <div className={styles.productBody}>
                      <h4 className={styles.productTitle}>{product.title}</h4>

                      <div className={styles.productMeta}>
                        <span className={styles.location}>📍 {product.location}</span>
                      </div>

                      <div className={styles.productPrice}>
                        <span className="price">RM {product.price}</span>
                        {product.originalPrice && (
                          <span className="price-old">RM {product.originalPrice}</span>
                        )}
                      </div>

                      <div className={styles.productRating}>
                        <span className={styles.stars}>
                          {'⭐'.repeat(Math.floor(product.rating))}
                        </span>
                        <span className={styles.ratingText}>
                          {product.rating} ({product.reviews} reviews)
                        </span>
                      </div>

                      <div className={styles.productSeller}>
                        <span className={styles.sellerName}>{product.seller}</span>
                      </div>

                      <button className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}>
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.noResults}>
                <p>No products found matching your criteria</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('All');
                  }}
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className="container">
          <div className={styles.footerGrid}>
            <div className={styles.footerCol}>
              <h4>About Us</h4>
              <ul>
                <li><a href="#">About Transcendence</a></li>
                <li><a href="#">Contact Us</a></li>
                <li><a href="#">Blog</a></li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Support</h4>
              <ul>
                <li><a href="#">Help Center</a></li>
                <li><a href="#">Safety Tips</a></li>
                <li><a href="#">Report Item</a></li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Community</h4>
              <ul>
                <li><a href="#">Terms & Conditions</a></li>
                <li><a href="#">Privacy Policy</a></li>
                <li><a href="#">Careers</a></li>
              </ul>
            </div>
            <div className={styles.footerCol}>
              <h4>Follow Us</h4>
              <div className={styles.socialLinks}>
                <a href="#">Facebook</a>
                <a href="#">Instagram</a>
                <a href="#">Twitter</a>
              </div>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <p>&copy; 2024 Transcendence Marketplace. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
