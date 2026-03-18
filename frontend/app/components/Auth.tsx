"use client";
import { supabase } from "@/lib/supabase";
import { LogIn, LogOut, User } from "lucide-react";

interface AuthProps {
  user: any;
  onAuthChange: () => void;
}

export default function Auth({ user, onAuthChange }: AuthProps) {
  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    onAuthChange();
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          {user.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt="avatar"
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="bg-gray-700 p-1.5 rounded-full">
              <User className="w-4 h-4 text-gray-300" />
            </div>
          )}
          <span className="text-xs text-gray-300 hidden sm:block truncate max-w-32">
            {user.user_metadata?.full_name || user.email}
          </span>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:block">Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={signInWithGoogle}
      className="flex items-center gap-2 text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-gray-900 font-medium transition-colors"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Sign in with Google
    </button>
  );
}