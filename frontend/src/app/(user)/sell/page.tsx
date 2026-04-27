'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header/Header';
import { useAuth } from '@/modules/user/components/AuthContext';
import { useToast } from '@/components/Toast/ToastContext';
import styles from './sell.module.css';

const WEIGHT_CATEGORIES = ['1U', '2U', '3U', '4U', '5U', '6U', '7U', '8U'];
const FLEXIBILITY_CATEGORIES = ['Stiff Shaft', 'Medium Flex', 'High Flexibility'];
const BALANCE_CATEGORIES = ['Head Heavy', 'Even Balance', 'Head Light'];

export default function SellPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    originalPrice: '',
    image: '',
    location: '',
    weightCategory: '4U',
    flexibilityCategory: 'Medium Flex',
    balanceCategory: 'Even Balance',
    isNew: true,
    isFeatured: false,
  });

  const handleSearch = () => {
    if (!searchInput.trim()) {
      router.push('/');
      return;
    }
    router.push(`/?search=${encodeURIComponent(searchInput.trim())}`);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!user) {
      showToast('Please login before posting a product', 'error');
      router.push('/login');
      return;
    }

    if (!form.title.trim()) {
      showToast('Product title is required', 'error');
      return;
    }

    const parsedPrice = parseFloat(form.price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      showToast('Please enter a valid price', 'error');
      return;
    }

    const parsedOriginalPrice = form.originalPrice.trim() ? parseFloat(form.originalPrice) : undefined;
    if (typeof parsedOriginalPrice === 'number' && (!Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice <= 0)) {
      showToast('Original price must be a valid positive number', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('http://localhost:8080/api/v1/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sellerId: user.id,
          sellerName: user.username,
          title: form.title.trim(),
          description: form.description.trim(),
          weightCategory: form.weightCategory,
          flexibilityCategory: form.flexibilityCategory,
          balanceCategory: form.balanceCategory,
          price: parsedPrice,
          originalPrice: parsedOriginalPrice,
          location: form.location.trim(),
          image: form.image.trim(),
          isNew: form.isNew,
          isFeatured: form.isFeatured,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error || 'Failed to create product');
      }

      showToast('Product posted successfully', 'success');
      router.push('/');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.main}>
      <Header
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={handleSearch}
      />

      <div className={`container ${styles.container}`}>
        <h2 className={styles.title}>Post a Product for Sale</h2>
        <p className={styles.subtitle}>Fill in the details below to publish your listing.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Product Title
            <input
              className={styles.input}
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. Yonex Astrox 88D"
              required
            />
          </label>

          <label className={styles.label}>
            Description
            <textarea
              className={styles.textarea}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Describe your product condition, accessories, and reason for selling"
              rows={4}
            />
          </label>

          <div className={styles.grid2}>
            <label className={styles.label}>
              Price (RM)
              <input
                type="number"
                className={styles.input}
                min="1"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                required
              />
            </label>

            <label className={styles.label}>
              Original Price (optional)
              <input
                type="number"
                className={styles.input}
                min="1"
                step="0.01"
                value={form.originalPrice}
                onChange={(e) => setForm((prev) => ({ ...prev, originalPrice: e.target.value }))}
              />
            </label>
          </div>

          <div className={styles.grid3}>
            <label className={styles.label}>
              Weight Category
              <select
                className={styles.input}
                value={form.weightCategory}
                onChange={(e) => setForm((prev) => ({ ...prev, weightCategory: e.target.value }))}
              >
                {WEIGHT_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              Flexibility
              <select
                className={styles.input}
                value={form.flexibilityCategory}
                onChange={(e) => setForm((prev) => ({ ...prev, flexibilityCategory: e.target.value }))}
              >
                {FLEXIBILITY_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              Balance
              <select
                className={styles.input}
                value={form.balanceCategory}
                onChange={(e) => setForm((prev) => ({ ...prev, balanceCategory: e.target.value }))}
              >
                {BALANCE_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.label}>
              Location
              <input
                className={styles.input}
                value={form.location}
                onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                placeholder="e.g. Kuala Lumpur"
              />
            </label>

            <label className={styles.label}>
              Image URL (optional)
              <input
                className={styles.input}
                value={form.image}
                onChange={(e) => setForm((prev) => ({ ...prev, image: e.target.value }))}
                placeholder="https://..."
              />
            </label>
          </div>

          <div className={styles.checkboxRow}>
            <label>
              <input
                type="checkbox"
                checked={form.isNew}
                onChange={(e) => setForm((prev) => ({ ...prev, isNew: e.target.checked }))}
              />{' '}
              Mark as New
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(e) => setForm((prev) => ({ ...prev, isFeatured: e.target.checked }))}
              />{' '}
              Mark as Featured
            </label>
          </div>

          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Posting...' : 'Post Product'}
          </button>
        </form>
      </div>
    </main>
  );
}
