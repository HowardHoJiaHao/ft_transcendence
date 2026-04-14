import styles from './Footer.module.css';

export default function Footer() {
    return (
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
            <p>&copy; 2026 TransMarket. All rights reserved.</p>
          </div>
        </div>
      </footer>
    );
}