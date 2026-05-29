"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from "react";
import { X } from "lucide-react";

// Types
interface TutorialContextType {
  isOpen: boolean;
  currentStep: number;
  openTutorial: () => void;
  closeTutorial: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTutorial: () => void;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export const useTutorial = () => {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return context;
};

// Data
const TUTORIAL_STEPS = [
  {
    title: "Wallets",
    content: "What is a wallet? A crypto wallet is your gateway to the blockchain. It proves your ownership of digital assets like NFTs. Why ownership matters: Only you have access to your items, giving you true control without middlemen.",
  },
  {
    title: "Gas Fees",
    content: "What are network fees? Gas fees are small payments made to compensate the network for processing your transactions. Why transactions cost fees: They keep the decentralized network secure and running smoothly.",
  },
  {
    title: "Self Custody",
    content: "Protect your seed phrases! Your seed phrase is the master key to your wallet. Never share it with anyone. No password recovery: If you lose your phrase, your assets cannot be recovered by anyone, not even us.",
  },
  {
    title: "Buying and Selling NFTs",
    content: "Marketplace workflow: To buy, connect your wallet, browse the collection, and confirm the transaction. To sell, mint your art or list existing NFTs, setting your price directly on the blockchain.",
  },
];

// Components
export const TutorialProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const hasCompleted = localStorage.getItem("afristore_tutorial_completed");
    if (!hasCompleted) {
      setIsOpen(true);
    }
  }, []);

  const openTutorial = () => {
    setCurrentStep(0);
    setIsOpen(true);
  };

  const closeTutorial = () => {
    setIsOpen(false);
    localStorage.setItem("afristore_tutorial_completed", "true");
  };

  const skipTutorial = () => {
    closeTutorial();
  };

  const nextStep = () => {
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      closeTutorial();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  if (!mounted) return <>{children}</>;

  return (
    <TutorialContext.Provider
      value={{
        isOpen,
        currentStep,
        openTutorial,
        closeTutorial,
        nextStep,
        prevStep,
        skipTutorial,
      }}
    >
      {children}
      {isOpen && <TutorialModal />}
    </TutorialContext.Provider>
  );
};

export const TutorialModal = () => {
  const { closeTutorial, currentStep, nextStep, prevStep, skipTutorial } = useTutorial();
  const modalRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTutorial();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    // Focus management
    modalRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeTutorial]);

  const step = TUTORIAL_STEPS[currentStep];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
    >
      <div 
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl outline-none dark:bg-gray-900"
      >
        <button 
          onClick={closeTutorial}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Dismiss tutorial"
        >
          <X className="h-5 w-5" />
        </button>

        <TutorialProgress />
        
        <TutorialStep step={step} />

        <div className="mt-8 flex items-center justify-between">
          <button 
            onClick={skipTutorial}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Skip Tutorial
          </button>
          
          <div className="flex space-x-3">
            <button
              onClick={prevStep}
              disabled={currentStep === 0}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
            >
              Previous
            </button>
            <button
              onClick={nextStep}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {currentStep === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const TutorialStep = ({ step }: { step: typeof TUTORIAL_STEPS[0] }) => {
  return (
    <div className="mt-4">
      <h2 id="tutorial-title" className="text-2xl font-bold text-gray-900 dark:text-white">
        {step.title}
      </h2>
      <p className="mt-4 leading-relaxed text-gray-600 dark:text-gray-300">
        {step.content}
      </p>
    </div>
  );
};

export const TutorialProgress = () => {
  const { currentStep } = useTutorial();
  
  return (
    <div className="flex space-x-2" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={TUTORIAL_STEPS.length}>
      {TUTORIAL_STEPS.map((_, idx) => (
        <div 
          key={idx}
          className={`h-1.5 flex-1 rounded-full ${idx <= currentStep ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}`}
        />
      ))}
    </div>
  );
};
