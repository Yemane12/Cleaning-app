/**
 * Every piece of text the app shows, in English. Another language is a file
 * of the same shape (typed `Messages`, so a missing string fails the build)
 * registered in ../locales.ts — no screen changes.
 *
 * `{name}` marks a value filled in at runtime.
 */
export const en = {
  app: {
    name: 'Cleaning',
    tagline: 'Trusted home cleaners in Addis Ababa',
  },
  nav: {
    book: 'Book a cleaner',
    bookings: 'My bookings',
    account: 'Account',
    signIn: 'Sign in',
    signUp: 'Sign up',
    signOut: 'Sign out',
  },
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    back: 'Back',
    save: 'Save',
    saved: 'Saved',
    cancel: 'Cancel',
    optional: 'optional',
    unnamedCleaner: 'Cleaner',
    duration: '{hours} h {minutes} min',
    durationHours: '{hours} h',
    errors: {
      network: 'Could not reach the server. Check your connection and try again.',
      generic: 'Something went wrong: {message}',
      session: 'Your session has ended. Please sign in again.',
    },
  },
  home: {
    title: 'A clean home, booked in minutes',
    subtitle:
      'Choose a verified cleaner, pick a time that suits you and pay safely with telebirr, CBE Birr, M-Pesa or card.',
    cta: 'Book a cleaner',
    steps: {
      title: 'How it works',
      choose: 'Choose a service and a verified cleaner.',
      time: 'Pick a day and a free time slot.',
      pay: 'Pay securely through Chapa. Cancel free up to 24 hours before.',
    },
    trust: 'Every cleaner has had their identity checked.',
  },
  auth: {
    signInTitle: 'Sign in',
    signUpTitle: 'Create your account',
    fullName: 'Full name',
    email: 'Email',
    phone: 'Phone number',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    showPassword: 'Show password',
    submitSignIn: 'Sign in',
    submitSignUp: 'Create account',
    noAccount: 'New here?',
    haveAccount: 'Already have an account?',
    checkEmail:
      'We sent a link to {email}. Open it within an hour to confirm your address, then sign in. Not there? Look in your spam folder.',
    noEmail: 'No email?',
    resend: 'Send a new link',
    resent: 'We sent a new link to {email}. Open it within an hour.',
    linkExpired:
      'That link has expired or was already used. Sign in below: if your email still needs confirming, you can get a new link.',
    linkFailed:
      'That link did not work. Sign in below: if your email still needs confirming, you can get a new link.',
    problems: {
      invalidCredentials: 'Email or password is not right.',
      emailNotConfirmed:
        'Your email address is not confirmed yet. Open the link we emailed you, or get a new one.',
      emailLimit:
        'We cannot send another email right now: too many were sent in the last hour. Please try again later.',
      tooManyAttempts: 'Too many attempts. Please wait a few minutes and try again.',
      emailInvalid: 'That email address does not look right.',
    },
    notCustomer: 'This app is for customers for now. Sign in with a customer account to book.',
  },
  book: {
    title: 'Book a cleaner',
    service: {
      title: 'What do you need?',
      from: 'from {price}',
      duration: 'How long?',
      price: 'Price: {price}',
      none: 'No services are available yet.',
    },
    cleaner: {
      title: 'Who should come?',
      none: 'No cleaners are available yet. Please check back soon.',
    },
    time: {
      title: 'When?',
      day: 'Day',
      slots: 'Free times on {day}',
      none: 'No free times on this day. Try another day.',
      zone: 'Times are in Addis Ababa time.',
    },
    address: {
      title: 'Where?',
      add: 'Add a new address',
      label: 'Name for this address',
      labelHint: 'For example: Home',
      line1: 'Street, area or landmark',
      line2: 'House or apartment number',
      city: 'City',
      notes: 'Directions for the cleaner',
      saveAddress: 'Save address',
      none: 'You have no saved addresses yet.',
    },
    review: {
      title: 'Check and pay',
      notes: 'Anything the cleaner should know?',
      summary: '{service} with {cleaner}',
      when: '{when}, {duration}',
      total: 'Total',
      policy:
        'Free cancellation up to 24 hours before the start. After that, half of the price is kept for the cleaner.',
      pay: 'Pay {price} with Chapa',
      paying: 'Opening payment…',
    },
  },
  payment: {
    checking: 'Checking your payment…',
    paidTitle: 'Payment received',
    paidBody: 'Booking {reference} is confirmed as paid. Your cleaner will now accept it.',
    pendingTitle: 'We have not received the payment yet',
    pendingBody:
      'If you just paid, it can take a moment to arrive. If the payment did not go through, you can pay again.',
    checkAgain: 'Check again',
    payNow: 'Pay now',
    failed: 'The payment did not go through: {reason}',
    viewBooking: 'View booking',
    missingBooking: 'We could not tell which booking this payment was for.',
  },
  bookings: {
    title: 'My bookings',
    none: 'You have no bookings yet.',
    reference: 'Booking {reference}',
    with: 'with {cleaner}',
    status: {
      PENDING_PAYMENT: 'Waiting for payment',
      REQUESTED: 'Waiting for the cleaner',
      ACCEPTED: 'Confirmed',
      DECLINED: 'Declined by the cleaner',
      IN_PROGRESS: 'In progress',
      COMPLETED: 'Completed',
      CANCELLED_BY_CUSTOMER: 'Cancelled by you',
      CANCELLED_BY_CLEANER: 'Cancelled by the cleaner',
    },
  },
  booking: {
    when: 'When',
    where: 'Where',
    service: 'Service',
    cleaner: 'Cleaner',
    price: 'Price',
    notes: 'Your notes',
    payment: 'Payment',
    paymentStatus: {
      REQUIRES_PAYMENT: 'Not paid yet',
      PAID: 'Paid',
      CANCELED: 'Not charged',
      PARTIALLY_REFUNDED: 'Partly refunded',
      REFUNDED: 'Refunded',
    },
    refund: {
      DONE: 'Refunded {amount}',
      PENDING: 'Refund of {amount} on its way',
      NEEDS_REVIEW: 'Refund of {amount} is being checked by our team',
    },
    checkPayment: 'Check payment',
    cancel: {
      button: 'Cancel booking',
      free: 'Cancelling now is free: you get the full amount back.',
      late: 'This booking starts within 24 hours: half of the price is kept for the cleaner, the rest is refunded.',
      unpaid: 'Nothing has been paid, so nothing is charged.',
      reason: 'Reason',
      confirm: 'Yes, cancel',
      keep: 'Keep booking',
      done: 'The booking is cancelled.',
    },
  },
  account: {
    title: 'Your account',
    saved: 'Your details are saved.',
  },
} as const;
