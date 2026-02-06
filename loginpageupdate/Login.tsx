import React, { useState, FormEvent } from 'react';
import styles from './Login.module.css';

const Login: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (email && password) {
      alert(`Login functionality would be implemented here.\n\nEmail: ${email}`);
    }
  };

  const togglePassword = () => {
    setShowPassword(!showPassword);
  };

  const handleForgotPassword = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    alert('Password reset functionality would be implemented here');
  };

  const handleGoogleSignIn = () => {
    alert('Google sign-in would be implemented here');
  };

  const handleAppleSignIn = () => {
    alert('Apple sign-in would be implemented here');
  };

  const handleSignUp = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    alert('Sign up page would be implemented here');
  };

  return (
    <div className={styles.container}>
      {/* Left Side - Login Form */}
      <div className={styles.leftSide}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>{'{..}'}</div>
          <div className={styles.logoText}>SoftQA</div>
        </div>

        <div className={styles.formContainer}>
          <h1>Welcome Back!</h1>
          <p className={styles.subtitle}>
            Sign in to access your dashboard and continue optimizing your QA process.
          </p>

          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label htmlFor="email">Email</label>
              <div className={styles.inputWrapper}>
                <i className="fas fa-envelope input-icon"></i>
                <input
                  type="email"
                  id="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="password">Password</label>
              <div className={`${styles.inputWrapper} ${styles.passwordWrapper}`}>
                <i className="fas fa-lock input-icon"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className={styles.togglePassword}
                  onClick={togglePassword}
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
              <div className={styles.forgotPassword}>
                <a href="#" onClick={handleForgotPassword}>
                  Forgot Password?
                </a>
              </div>
            </div>

            <button type="submit" className={styles.signInBtn}>
              Sign In
            </button>
          </form>

          <div className={styles.divider}>OR</div>

          <button className={styles.socialBtn} onClick={handleGoogleSignIn}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M19.8055 10.2292C19.8055 9.55556 19.7499 8.87499 19.6305 8.20833H10.2V12.0208H15.6012C15.3751 13.2292 14.6764 14.2917 13.6597 15C14.4792 15.5639 15.4167 15.9583 16.4166 16.1458C18.5832 14.2083 19.8055 11.3958 19.8055 10.2292Z"
                fill="#4285F4"
              />
              <path
                d="M10.2 20C12.7541 20 14.8874 19.1042 16.4166 16.1458L13.6597 15C12.8319 15.5347 11.7916 15.8542 10.2 15.8542C7.73325 15.8542 5.65825 13.9028 4.92075 11.375H2.05408V13.5139C3.61575 16.625 6.72908 20 10.2 20Z"
                fill="#34A853"
              />
              <path
                d="M4.92075 11.375C4.50825 10.2292 4.50825 8.77778 4.92075 7.625V5.48611H2.05408C0.745083 8.08333 0.745083 11.9167 2.05408 14.5139L4.92075 11.375Z"
                fill="#FBBC04"
              />
              <path
                d="M10.2 4.14583C11.8624 4.11806 13.4652 4.73611 14.6624 5.875L17.0749 3.45833C14.7874 1.29167 11.786 0.0763889 10.2 0.104167C6.72908 0.104167 3.61575 3.375 2.05408 5.48611L4.92075 7.625C5.65825 5.09722 7.73325 4.14583 10.2 4.14583Z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <button className={styles.socialBtn} onClick={handleAppleSignIn}>
            <i className="fab fa-apple" style={{ fontSize: '20px' }}></i>
            Continue with Apple
          </button>

          <div className={styles.signupLink}>
            Don't have an Account?{' '}
            <a href="#" onClick={handleSignUp}>
              Sign Up
            </a>
          </div>
        </div>
      </div>

      {/* Right Side - Hero Section */}
      <div className={styles.rightSide}>
        <div className={styles.heroContent}>
          <h2 className={styles.heroTitle}>
            Revolutionize QA with Smarter Automation
          </h2>

          <div className={styles.testimonial}>
            <div className={styles.quote}>
              "SoftQA has completely transformed our testing process. It's reliable,
              efficient, and ensures our releases are always top-notch."
            </div>
            <div className={styles.author}>
              <div className={styles.authorImg}>MC</div>
              <div className={styles.authorInfo}>
                <h4>Michael Carter</h4>
                <p>Software Engineer at DevCore</p>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.teamsSection}>
          <div className={styles.teamsTitle}>JOIN 1K+ TEAMS</div>
          <div className={styles.companyLogos}>
            <div className={styles.companyLogo}>
              <i className="fab fa-discord"></i> Discord
            </div>
            <div className={styles.companyLogo}>
              <i className="fab fa-mailchimp"></i> Mailchimp
            </div>
            <div className={styles.companyLogo}>
              <i className="fab fa-grammarly"></i> Grammarly
            </div>
            <div className={styles.companyLogo}>
              <i className="fas fa-bullhorn"></i> Attentive
            </div>
            <div className={styles.companyLogo}>
              <i className="fas fa-signature"></i> HelloSign
            </div>
            <div className={styles.companyLogo}>
              <i className="fas fa-comments"></i> Intercom
            </div>
            <div className={styles.companyLogo}>
              <i className="fab fa-square"></i> Square
            </div>
            <div className={styles.companyLogo}>
              <i className="fab fa-dropbox"></i> Dropbox
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
