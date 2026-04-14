'use client';

import { useState, useEffect } from 'react'; //std react hook for managing local state & side effects
import { useRouter } from 'next/navigation'; //programmatic navigation
import { useAuth } from '@/modules/user/components/AuthContext'; //import hook to access global authentication data
import styles from './page.module.css'; //import CSS module for scope styling
import Header from '@/components/Header/Header';

interface Product
{
  id: number;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  weightCategory: string;
  flexibilityCategory: string;
  balanceCategory: string;
  location: string;
  seller: string;
  rating: number;
  reviews: number;
  isNew: boolean;
  isFeatured: boolean;
}

const WEIGHT_CATEGORIES = [
  'All',
  '1U',
  '2U',
  '3U',
  '4U',
  '5U',
  '6U',
  '7U',
  '8U',
];

const FLEXIBILITY_CATEGORIES = [
  'All',
  'Stiff Shaft',
  'Medium Flex',
  'High Flexibility',
];

const BALANCE_CATEGORIES = [
  'All',
  'Head Heavy',
  'Even Balance',
  'Head Light',
];

export default function Home()
{
  const router = useRouter();
  const { user, logout } = useAuth();
  const [selectedWeightCategory, setSelectedWeightCategory] = useState('All');
  const [selectedFlexibilityCategory, setSelectedFlexibilityCategory] = useState('All');
  const [selectedBalanceCategory, setSelectedBalanceCategory] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [products, setProducts] = useState<Product[]>([]); //declare a product array. declare the array is empty
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = () => {
    setSearchQuery(searchInput);
  }

  // Fetch products from API
  //new URLSearchParams(window.location.search) gives search query and get('search') gives value of search key.
  useEffect(() =>
	{
    const urlSearch = typeof window === 'undefined'
                ? null : new URLSearchParams(window.location.search).get('search'); //if the search comes from url (other page), get they word from the key search
    const currentSearch = urlSearch ?? searchQuery; //if empty, means it dont come from url, use the searchQuery
    if (urlSearch && urlSearch !== searchQuery) //if both exist but different, means it come from url, update searchQuery following url
      setSearchQuery(urlSearch);

    const fetchProducts = async () => {
      try {
        setLoading(true);
        const query = new URLSearchParams();
        if (selectedWeightCategory !== 'All')
          query.append('weightCategory', selectedWeightCategory);
        if (selectedFlexibilityCategory !== 'All')
          query.append('flexibilityCategory', selectedFlexibilityCategory);
		    if (selectedBalanceCategory !== 'All')
			  query.append('balanceCategory', selectedBalanceCategory);
        if (currentSearch)
          query.append('search', currentSearch);
        query.append('sort', sortBy);

        const response = await fetch(
          `http://localhost:8080/api/v1/products?${query}`
        );

        if (!response.ok)
          throw new Error('Failed to fetch products');

        const data = await response.json();
        const mappedProducts = data.products.map((p: any) => ({ //for every single data call everything for a while then take the p and turn it into object below
          id: p.id,
          title: p.title,
          price: parseFloat(p.price),
          originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : undefined,
          image: p.image,
          weightCategory: p.weightCategory,
          flexibilityCategory: p.flexibilityCategory,
		  balanceCategory: p.balanceCategory,
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
  }, [selectedWeightCategory, selectedFlexibilityCategory, selectedBalanceCategory, searchQuery, sortBy]);

  return (
    <main className={styles.main}>
      {/* Header */}
      <Header
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={handleSearch}
      />

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
                    setSelectedWeightCategory('All');
                    setSelectedFlexibilityCategory('All');
					setSelectedBalanceCategory('All');
                  }}
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
