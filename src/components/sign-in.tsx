"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "./ui";

export function SignIn() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<{ email: string; password: string }>();
  return (
    <form
      className="stack"
      method="post"
      action="/api/auth/sign-in/email"
      onSubmit={handleSubmit(async (values) => {
        try {
          const response = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values),
          });
          if (response.ok) {
            router.replace("/");
            router.refresh();
            return;
          }
          setError("root", {
            message:
              response.status === 429
                ? "Too many attempts. Wait a minute and try again."
                : "Email or password is incorrect.",
          });
        } catch {
          setError("root", { message: "Sign-in is unavailable. Try again." });
        }
      })}
    >
      <label className="field">
        Email address
        <input
          type="email"
          autoComplete="username"
          required
          {...register("email", { required: true, maxLength: 254 })}
        />
      </label>
      <label className="field">
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          {...register("password", { required: true, maxLength: 128 })}
        />
      </label>
      {errors.root && (
        <p className="alert warn" role="alert">
          {errors.root.message}
        </p>
      )}
      {(errors.email || errors.password) && (
        <p className="alert warn" role="alert">
          Check your email address and password.
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}{" "}
        <ArrowRight size={17} aria-hidden="true" />
      </Button>
    </form>
  );
}
