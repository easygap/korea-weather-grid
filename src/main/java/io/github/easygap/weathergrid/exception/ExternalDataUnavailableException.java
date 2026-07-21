package io.github.easygap.weathergrid.exception;

/** 공공데이터포털 인증·응답·상류 장애를 외부에 일반화해 전달한다. */
public class ExternalDataUnavailableException extends RuntimeException {

    public ExternalDataUnavailableException() {
        super("external data temporarily unavailable");
    }
}
